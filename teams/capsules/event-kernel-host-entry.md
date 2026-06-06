# Context Capsule: review event-kernel host entry/adapters

## artifact
tools/HME/event_kernel/host_hook_entry.js and tools/HME/event_kernel/host_adapter_common.js -- the host hook entrypoint and shared adapter plumbing that drain stdin, suppress lifecycle hooks for team peers, choose host adapters, relay lifecycle events through /hme/lifecycle, and fall back to direct event-kernel dispatch when the proxy is unavailable.

## goal
Find decision-changing correctness/safety flaws in the event-kernel host-entry path that could hang hooks, drop or corrupt hook decisions, leak peer lifecycle events into the driver lifecycle, fail open/closed incorrectly during proxy outages, or route a host event through the wrong adapter. Cite function/block + fix.

## constraints
This code runs inside host hook processes; it must be bounded, non-recursive, and valid for Claude/Codex/OpenCode. Team peers are driver forks with full context/tools but HME_TEAM_PEER=1 must suppress driver lifecycle hooks for their ephemeral `claude -p` sub-sessions without bypassing tool/permission policy hooks. Proxy-down fallback is intentional, but fallback must preserve valid host hook output. Avoid style findings and do not review dispatcher.js internals here except where host_adapter_common calls lifecycle.dispatch().

## rubric
Classify P0/P1/P2. For each finding: function/block, exact failure mode, one-line fix. Reject speculative host behavior without evidence. Prefer unbounded waits/buffers, env/root resolution, stale process state, stdin handling, proxy timeout/fallback, and peer lifecycle bypass bugs.

## coverage
included: full source for host_hook_entry.js including arg, eventFromArg, adapterForHost, shouldBypassPeerLifecycle, failSafeStdout, readStdinBounded, spawnSync timeout/killSignal, stdin forwarding, stdout/stderr relay, and exit status; full source for host_adapter_common.js including OversizeStdinError, _stdinTooLargeResult, readStdin, resolveRoot, append, maintenanceActive, postLifecycle response cap, _postLifecycleOrNull, and runHostAdapter.
excluded: dispatcher.js internals, host-specific adapter finalRelay normalization, hook shell scripts, proxy /hme/lifecycle route implementation, ask-peer.sh.

## evidence
tools/HME/event_kernel/host_hook_entry.js
```js
#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { renderDeny } = require('./decision_renderer');

const MAX_STDIN_BYTES = 1024 * 1024;
const ADAPTER_TIMEOUT_MS = 150_000;
const PEER_BYPASS_EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'Stop', 'PreCompact', 'PostCompact']);
const GATING_EVENTS = new Set(['PreToolUse', 'PermissionRequest']);

function arg(name, argv = process.argv) {
  const idx = argv.indexOf(`--${name}`);
  return idx >= 0 ? argv[idx + 1] : '';
}

function eventFromArg(argv = process.argv) {
  return arg('event', argv) || argv[2] || '';
}

function adapterForHost(host, root = path.resolve(__dirname, '..')) {
  return host === 'codex'
    ? path.join(root, 'event_kernel', 'codex_adapter.js')
    : host === 'opencode'
      ? path.join(root, 'event_kernel', 'opencode_adapter.js')
      : host === 'claude'
        ? path.join(root, 'event_kernel', 'claude_adapter.js')
        : '';
}

function shouldBypassPeerLifecycle(event, env = process.env) {
  return env.HME_TEAM_PEER === '1' && PEER_BYPASS_EVENTS.has(event);
}

function failSafeStdout(event, message) {
  return GATING_EVENTS.has(event) ? renderDeny(event, message) : '';
}

function exitFailSafe(event, message, code = 0) {
  const stdout = failSafeStdout(event, message);
  if (stdout) process.stdout.write(stdout);
  if (message) process.stderr.write(`[host_hook_entry] ${message}\n`);
  process.exit(code);
}

function readStdinBounded(event, fd = 0) {
  const chunks = [];
  let total = 0;
  const buf = Buffer.allocUnsafe(64 * 1024);
  while (true) {
    let n = 0;
    try {
      n = fs.readSync(fd, buf, 0, buf.length, null);
    } catch (err) {
      // silent-ok: stdin read errors are surfaced immediately as host-hook stderr
      // and a fail-safe gating denial where applicable.
      exitFailSafe(event, `stdin read failed: ${err.message}`, GATING_EVENTS.has(event) ? 0 : 1);
    }
    if (n === 0) break;
    total += n;
    if (total > MAX_STDIN_BYTES) {
      exitFailSafe(event, `stdin exceeded ${MAX_STDIN_BYTES} bytes`);
    }
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(chunks).toString('utf8') || '{}';
}

function main() {
  const host = arg('host');
  const event = eventFromArg();
  const root = path.resolve(__dirname, '..');
  const stdin = readStdinBounded(event);

  // Ephemeral team-peer sub-sessions (ask-peer.sh sets HME_TEAM_PEER=1) must NOT
  // run the driver's orchestration lifecycle. Tool/permission events still flow
  if (shouldBypassPeerLifecycle(event)) process.exit(0);

  const adapter = adapterForHost(host, root);
  if (!adapter) {
    console.error(`host_hook_entry: unsupported host ${JSON.stringify(host)}`);
    process.exit(1);
  }

  const child = spawnSync(process.execPath, [adapter, event], {
    input: stdin,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
    timeout: ADAPTER_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });

  if (child.error) {
    const timedOut = child.error.code === 'ETIMEDOUT';
    exitFailSafe(event, `adapter ${timedOut ? 'timed out' : 'failed'} for ${event}: ${child.error.message}`);
  }
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  process.exit(child.status == null ? 1 : child.status);
}

if (require.main === module) main();

module.exports = {
  MAX_STDIN_BYTES,
  ADAPTER_TIMEOUT_MS,
  PEER_BYPASS_EVENTS,
  GATING_EVENTS,
  arg,
  eventFromArg,
  adapterForHost,
  shouldBypassPeerLifecycle,
  failSafeStdout,
};

```

tools/HME/event_kernel/host_adapter_common.js
```js
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

```
