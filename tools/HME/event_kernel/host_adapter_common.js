'use strict';
const { requireEnv: _hmeRequireEnv } = require('../proxy/shared/load_env.js');

const fs = require('fs');
const http = require('http');
const path = require('path');
const { createLifecycleGraph } = require('./lifecycle_graph');
const timeTravel = require('./lifecycle_time_travel');
const watchdog = require('./hook_watchdog');
const { nudgeSupervisors } = require('./supervisors');

const LOOP_EVENTS = new Set(['Stop', 'UserPromptSubmit', 'SessionStart', 'PreCompact', 'PostCompact']);
const MAX_STDIN_BYTES = 1024 * 1024;

function readStdin(label) {
  return new Promise((resolve) => {
    let input = '';
    process.stdin.on('data', (chunk) => {
      input += chunk.toString('utf8');
      if (input.length > MAX_STDIN_BYTES) {
        process.stderr.write(`[${label}] stdin exceeded ${MAX_STDIN_BYTES} bytes\n`);
        process.exit(0);
      }
    });
    process.stdin.on('end', () => resolve(input || '{}'));
  });
}

function resolveRoot(envKeys = []) {
  const candidates = envKeys.map((k) => process.env[k]).filter(Boolean);
  candidates.push(process.cwd());
  let dir = __dirname;
  while (dir && dir !== path.dirname(dir)) {
    candidates.push(dir);
    dir = path.dirname(dir);
  }
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
  } catch (err) {
    return false;
  }
}

function postLifecycle(port, event, body, host = '', timeoutMs = 60_000) {
  const payload = Buffer.from(body);
  const query = host ? `&host=${encodeURIComponent(host)}` : '';
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: `/hme/lifecycle?event=${encodeURIComponent(event)}${query}`,
      timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return resolve(null);
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
        catch (err) { resolve({ stdout: '', stderr: 'Non-JSON Proxy Response', exit_code: 1 }); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => req.destroy());
    req.write(payload);
    req.end();
  });
}

async function runHostAdapter(opts) {
  const event = opts.event;
  if (LOOP_EVENTS.has(event) && process.env.HME_THREAD_CHILD === '1') process.exit(0);
  const root = resolveRoot(opts.rootEnvKeys || ['PROJECT_ROOT']);
  process.env.PROJECT_ROOT = root;
  if (opts.hostProjectEnv) process.env[opts.hostProjectEnv] = root;
  const port = Number(_hmeRequireEnv('HME_PROXY_PORT'));
  nudgeSupervisors(root);
  const rawBody = await readStdin(`${opts.host}_adapter`);
  const body = opts.buildBody({ event, root, rawBody, cwd: process.cwd() });
  let payload = {};
  try { payload = JSON.parse(body || '{}'); } catch (_err) { payload = {}; }
  const lifecycle = createLifecycleGraph({ root, host: opts.host, event, body, payload });
  const thread_id = lifecycle.thread_id;
  lifecycle.checkpoint('adapter:received', { rawBody }, 'input');
  lifecycle.checkpoint('adapter:normalized', { body });
  const watch = watchdog.begin(root, event, body, { host: opts.host });
  let result = await postLifecycle(port, event, body, opts.host === 'codex' ? 'codex' : '');
  if (!result) {
    await new Promise((r) => setTimeout(r, 500));
    result = await postLifecycle(port, event, body, opts.host === 'codex' ? 'codex' : '');
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
    timeTravel.checkpoint({ root, host: opts.host, event, payload, phase: 'transport:proxy', values: { thread_id, stdout: result.stdout || '', stderr: result.stderr || '', exit_code: result.exit_code } });
    opts.onProxyResult({ result, root, port, event, body, ts });
  }
  timeTravel.checkpoint({ root, host: opts.host, event, payload, phase: 'kernel:result', values: { thread_id, stdout: result.stdout || '', stderr: result.stderr || '', exit_code: result.exit_code } });
  watchdog.end(watch, result);
  if (opts.beforeFinalRelay) result = opts.beforeFinalRelay({ event, result, body, root }) || result;
  opts.finalRelay(event, result, body);
}

module.exports = { readStdin, resolveRoot, append, maintenanceActive, postLifecycle, runHostAdapter };
