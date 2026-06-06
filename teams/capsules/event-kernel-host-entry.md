# Context Capsule: review event-kernel host entry/adapters

## artifact
tools/HME/event_kernel/host_hook_entry.js and tools/HME/event_kernel/host_adapter_common.js -- the host hook entrypoint and shared adapter plumbing that drain stdin, suppress lifecycle hooks for team peers, choose host adapters, relay lifecycle events through /hme/lifecycle, and fall back to direct event-kernel dispatch when the proxy is unavailable.

## goal
Find decision-changing correctness/safety flaws in the event-kernel host-entry path that could hang hooks, drop or corrupt hook decisions, leak peer lifecycle events into the driver lifecycle, fail open/closed incorrectly during proxy outages, or route a host event through the wrong adapter. Cite function/block + fix.

## constraints
This code runs inside host hook processes; it must be bounded, non-recursive, and valid for Claude/Codex/OpenCode. Team peers are driver forks with full context/tools but HME_TEAM_PEER=1 must suppress driver lifecycle hooks for their ephemeral `claude -p` sub-sessions. Proxy-down fallback is intentional, but fallback must preserve valid host hook output. Avoid style findings and do not review dispatcher.js internals here except where host_adapter_common calls lifecycle.dispatch().

## rubric
Classify P0/P1/P2. For each finding: function/block, exact failure mode, one-line fix. Reject speculative host behavior without evidence. Prefer unbounded waits/buffers, env/root resolution, stale process state, stdin handling, proxy timeout/fallback, and peer lifecycle bypass bugs.

## coverage
included: full source for host_hook_entry.js including arg, host selection, HME_TEAM_PEER bypass, spawnSync adapter invocation, stdin forwarding, stdout/stderr relay, and exit status; full source for host_adapter_common.js including readStdin, resolveRoot, append, maintenanceActive, postLifecycle, and runHostAdapter.
excluded: dispatcher.js internals, host-specific adapter finalRelay normalization, hook shell scripts, proxy /hme/lifecycle route implementation, ask-peer.sh.

## evidence
tools/HME/event_kernel/host_hook_entry.js
```js
#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

function arg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : '';
}

const host = arg('host');
const event = arg('event') || process.argv[2] || '';
const root = path.resolve(__dirname, '..');

// Ephemeral team-peer sub-sessions (ask-peer.sh sets HME_TEAM_PEER=1) must NOT
// run the driver's orchestration lifecycle. A `-p` peer fires UserPromptSubmit
if (process.env.HME_TEAM_PEER === '1') {
  try { require('fs').readFileSync(0); } catch (_e) { /* no stdin: fine */ }
  process.exit(0);
}

const adapter = host === 'codex'
  ? path.join(root, 'event_kernel', 'codex_adapter.js')
  : host === 'opencode'
    ? path.join(root, 'event_kernel', 'opencode_adapter.js')
    : host === 'claude'
      ? path.join(root, 'event_kernel', 'claude_adapter.js')
      : '';

if (!adapter) {
  console.error(`host_hook_entry: unsupported host ${JSON.stringify(host)}`);
  process.exit(1);
}

const child = spawnSync(process.execPath, [adapter, event], {
  input: require('fs').readFileSync(0),
  encoding: 'utf8',
  stdio: ['pipe', 'pipe', 'pipe'],
  env: process.env,
});

if (child.stdout) process.stdout.write(child.stdout);
if (child.stderr) process.stderr.write(child.stderr);
process.exit(child.status == null ? 1 : child.status);

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
    // silent-ok: bad maintenance flag means inactive; hook dispatch continues.
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
  if (process.env.HME_ADAPTER_NO_NUDGE !== '1') nudgeSupervisors(root);
  const rawBody = await readStdin(`${opts.host}_adapter`);
  const body = opts.buildBody({ event, root, rawBody, cwd: process.cwd() });
  let payload = {};
  try { payload = JSON.parse(body || '{}'); } catch (_err) { payload = {}; }
  const lifecycle = createLifecycleGraph({ root, host: opts.host, event, body, payload });
  const thread_id = lifecycle.thread_id;
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
    lifecycle.recordTransport('proxy', result);
    opts.onProxyResult({ result, root, port, event, body, ts });
  }
  lifecycle.checkpoint('kernel:result', { stdout: result.stdout || '', stderr: result.stderr || '', exit_code: result.exit_code });
  watchdog.end(watch, result);
  if (opts.beforeFinalRelay) result = opts.beforeFinalRelay({ event, result, body, root }) || result;
  opts.finalRelay(event, result, body);
}

module.exports = { readStdin, resolveRoot, append, maintenanceActive, postLifecycle, runHostAdapter };

```
