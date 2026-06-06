'use strict';
const { requireEnv: _hmeRequireEnv } = require('../proxy/shared/load_env.js');

const fs = require('fs');
const http = require('http');
const path = require('path');
const { createLifecycleGraph } = require('./lifecycle_graph');
const watchdog = require('./hook_watchdog');
const { nudgeSupervisors } = require('./supervisors');
const { renderDeny } = require('./decision_renderer');

const LOOP_EVENTS = new Set(['Stop', 'UserPromptSubmit', 'SessionStart', 'PreCompact', 'PostCompact']);
const GATING_EVENTS = new Set(['PreToolUse', 'PermissionRequest']);
const MAX_STDIN_BYTES = 1024 * 1024;
const MAX_PROXY_RESPONSE_BYTES = 1024 * 1024;
const PROXY_ATTEMPT_TIMEOUT_MS = 15_000;

class OversizeStdinError extends Error {
  constructor(label, maxBytes) {
    super(`[${label}] stdin exceeded ${maxBytes} bytes`);
    this.code = 'HME_STDIN_TOO_LARGE';
  }
}

function _stdinTooLargeResult(event, err) {
  const message = err && err.message ? err.message : `stdin exceeded ${MAX_STDIN_BYTES} bytes`;
  return {
    stdout: GATING_EVENTS.has(event) ? renderDeny(event, message) : '',
    stderr: ' ',
    exit_code: 0,
  };
}

function readStdin(label) {
  return new Promise((resolve, reject) => {
    let input = '';
    let bytes = 0;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      try { process.stdin.pause(); } catch (_e) { /* silent-ok: stdin may be closed */ }
      reject(err);
    };
    process.stdin.on('data', (chunk) => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      bytes += buf.length;
      if (bytes > MAX_STDIN_BYTES) {
        fail(new OversizeStdinError(label, MAX_STDIN_BYTES));
        return;
      }
      input += buf.toString('utf8');
    });
    process.stdin.on('error', fail);
    process.stdin.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(input || '{}');
    });
  });
}

function _ancestorCandidates(start) {
  const out = [];
  let dir = path.resolve(start);
  while (dir && dir !== path.dirname(dir)) {
    out.push(dir);
    dir = path.dirname(dir);
  }
  return out;
}

function resolveRoot(envKeys = []) {
  const candidates = envKeys.map((k) => process.env[k]).filter(Boolean);
  candidates.push(..._ancestorCandidates(__dirname));
  candidates.push(process.cwd());
  for (const c of candidates) {
    const root = path.resolve(c);
    if (fs.existsSync(path.join(root, '.git')) && fs.existsSync(path.join(root, 'tools', 'HME'))) return root;
  }
  return path.resolve(__dirname, '..', '..', '..');
}

function append(file, line) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, line.endsWith('\n') ? line : `${line}\n`);
}

function maintenanceActive(root) {
  const flag = path.join(root, 'tmp', 'hme-proxy-maintenance.flag');
  try {
    const [started, ttlRaw] = fs.readFileSync(flag, 'utf8').split(/\r?\n/);
    const ttl = Number(ttlRaw);
    const start = Date.parse(started);
    return Number.isFinite(ttl) && Number.isFinite(start) && Date.now() - start < ttl * 1000;
    // silent-ok: bad maintenance flag means inactive; hook dispatch continues.
  } catch (err) {
    return false;
  }
}

function _proxyTransportError(message) {
  return { stdout: '', stderr: message, exit_code: 1, _hme_proxy_failed: true };
}

function _proxyFailed(result) {
  return Boolean(result && result._hme_proxy_failed);
}

function postLifecycle(port, event, body, host = '', timeoutMs = PROXY_ATTEMPT_TIMEOUT_MS) {
  const payload = Buffer.from(body);
  const query = host ? `&host=${encodeURIComponent(host)}` : '';
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: `/hme/lifecycle?event=${encodeURIComponent(event)}${query}`,
      timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
    }, (res) => {
      const chunks = [];
      let total = 0;
      res.on('data', (c) => {
        total += c.length;
        if (total > MAX_PROXY_RESPONSE_BYTES) {
          finish(_proxyTransportError(`Proxy lifecycle response exceeded ${MAX_PROXY_RESPONSE_BYTES} bytes`));
          req.destroy();
          res.destroy();
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => {
        if (settled) return;
        if (res.statusCode < 200 || res.statusCode >= 300) return finish(null);
        try { finish(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
        catch (err) { finish({ stdout: '', stderr: 'Non-JSON Proxy Response', exit_code: 1 }); }
      });
      res.on('error', () => finish(null));
    });
    req.on('error', () => finish(null));
    req.on('timeout', () => { finish(null); req.destroy(); });
    req.write(payload);
    req.end();
  });
}

async function _postLifecycleOrNull(root, port, event, body, host) {
  const result = await postLifecycle(port, event, body, host);
  if (!_proxyFailed(result)) return result;
  append(path.join(root, 'log', 'hme-proxy-lifecycle.log'), `[${new Date().toISOString()}] [host-adapter] proxy transport failure (event=${event}): ${result.stderr || 'unknown'}`);
  return null;
}

async function runHostAdapter(opts) {
  const event = opts.event;
  if (LOOP_EVENTS.has(event) && process.env.HME_THREAD_CHILD === '1') process.exit(0);
  const root = resolveRoot(opts.rootEnvKeys || ['PROJECT_ROOT']);
  process.env.PROJECT_ROOT = root;
  if (opts.hostProjectEnv) process.env[opts.hostProjectEnv] = root;
  const port = Number(_hmeRequireEnv('HME_PROXY_PORT'));
  if (process.env.HME_ADAPTER_NO_NUDGE !== '1') nudgeSupervisors(root);
  let rawBody;
  try {
    rawBody = await readStdin(`${opts.host}_adapter`);
  } catch (err) {
    // silent-ok: stdin failures are relayed through finalRelay as valid host output
    // (deny for gating events, diagnostic stderr otherwise).
    const result = err && err.code === 'HME_STDIN_TOO_LARGE'
      ? _stdinTooLargeResult(event, err)
      : { stdout: '', stderr: `[${opts.host}_adapter] stdin read failed: ${err.message || err}`, exit_code: GATING_EVENTS.has(event) ? 0 : 1 };
    opts.finalRelay(event, result, '{}');
    return;
  }
  const body = opts.buildBody({ event, root, rawBody, cwd: process.cwd() });
  let payload = {};
  try { payload = JSON.parse(body || '{}'); } catch (_err) { payload = {}; }
  const lifecycle = createLifecycleGraph({ root, host: opts.host, event, body, payload });
  lifecycle.checkpoint('adapter:received', { rawBody }, 'input');
  lifecycle.checkpoint('adapter:normalized', { body });
  const watch = watchdog.begin(root, event, body, { host: opts.host });
  if (opts.directOnly === true) {
    const ts = new Date().toISOString();
    append(path.join(root, 'log', 'hme-proxy-lifecycle.log'), `[${ts}] [${opts.host}-adapter] ${event} direct-only dispatch`);
    lifecycle.recordTransport('direct-only');
    const result = await lifecycle.dispatch();
    lifecycle.checkpoint('kernel:result', { stdout: result.stdout || '', stderr: result.stderr || '', exit_code: result.exit_code });
    watchdog.end(watch, result);
    opts.finalRelay(event, result, body);
    return;
  }
  let result = await _postLifecycleOrNull(root, port, event, body, opts.host === 'codex' ? 'codex' : '');
  if (!result) {
    await new Promise((r) => setTimeout(r, 500));
    result = await _postLifecycleOrNull(root, port, event, body, opts.host === 'codex' ? 'codex' : '');
  }
  const ts = new Date().toISOString();
  if (!result) {
    if (maintenanceActive(root)) {
      append(path.join(root, 'log', 'hme-proxy-lifecycle.log'), `[${ts}] [${opts.host}-adapter] proxy unreachable during maintenance (event=${event})`);
      result = { stdout: '', stderr: opts.maintenanceStderr || '', exit_code: 0 };
      lifecycle.recordTransport('maintenance', result);
    } else {
      append(path.join(root, 'log', 'hme-proxy-lifecycle.log'), `[${ts}] [${opts.host}-adapter] ${event} direct fallback (proxy down)`);
      lifecycle.recordTransport('direct-fallback');
      result = await lifecycle.dispatch();
      if (opts.onDirectFallback) result = opts.onDirectFallback({ result, root, port, event, body, ts }) || result;
    }
  } else if (opts.onProxyResult) {
    lifecycle.recordTransport('proxy', result);
    opts.onProxyResult({ result, root, port, event, body, ts });
  }
  lifecycle.checkpoint('kernel:result', { stdout: result.stdout || '', stderr: result.stderr || '', exit_code: result.exit_code });
  watchdog.end(watch, result);
  if (opts.beforeFinalRelay) result = opts.beforeFinalRelay({ event, result, body, root }) || result;
  opts.finalRelay(event, result, body);
}

module.exports = {
  readStdin,
  resolveRoot,
  append,
  maintenanceActive,
  postLifecycle,
  runHostAdapter,
  MAX_STDIN_BYTES,
  MAX_PROXY_RESPONSE_BYTES,
  PROXY_ATTEMPT_TIMEOUT_MS,
  GATING_EVENTS,
  _stdinTooLargeResult,
  _proxyFailed,
};
