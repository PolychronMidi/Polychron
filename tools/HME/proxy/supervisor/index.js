'use strict';
/**
 * HME process supervisor.
 *
 * Owns the spawn/health/restart lifecycle for all HME child processes.
 * Every child is a member of the proxy's ps-tree: `pkill -P <proxy_pid>`
 * kills everything cleanly without needing per-component restart logic.
 *
 * Architecture: shim starts first (owns GPU + RAG), then MCP starts (delegates
 * to shim). Proxy owns both. Single fate: if proxy dies, children die with it.
 */

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { emit, PROJECT_ROOT } = require('../shared');
const { CHILDREN } = require('./children');

const LOG_DIR = path.join(PROJECT_ROOT, 'log');

//  Supervisor state
const _children = new Map(); // name → { spec, proc, restarts, lastStart, lastHealthy, healthy }

function _logPath(name) {
  return path.join(LOG_DIR, `hme-${name}.out`);
}

function _spawnChild(spec) {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_e) { /* ignore */ }
  const logFd = fs.openSync(_logPath(spec.name), 'a');
  const env = typeof spec.env === 'function' ? spec.env() : (spec.env || process.env);
  const proc = spawn(spec.cmd, spec.args, {
    detached: false,   // stay in proxy's ps-tree
    stdio: ['ignore', logFd, logFd],
    env,
  });
  proc.on('error', (err) => {
    console.error(`[supervisor] ${spec.name} spawn error: ${err.message}`);
    emit({ event: 'supervisor_spawn_error', child: spec.name, reason: err.message });
  });
  proc.on('exit', (code, signal) => {
    const state = _children.get(spec.name);
    if (state && state.proc === proc) {
      console.error(`[supervisor] ${spec.name} exited (code=${code} signal=${signal})`);
      state.proc = null;
      state.healthy = false;
      emit({ event: 'child_exited', child: spec.name, code: code ?? signal ?? '?' });
    }
    fs.closeSync(logFd);
  });
  return proc;
}

async function _startChild(spec) {
  const existing = _children.get(spec.name);
  if (existing && existing.proc && existing.proc.exitCode === null) {
    return; // already running
  }
  // Pre-flight: if something is already serving on the health URL (surviving
  // process from a prior proxy run), adopt it rather than spawning a new one.
  // Without this, the new spawn immediately fails with EADDRINUSE and the
  // health loop never gets a chance to adopt — triggering the restart loop.
  if (spec.healthUrl) {
    const alreadyServing = await _probe(spec.healthUrl);
    if (alreadyServing) {
      console.log(`[supervisor] ${spec.name} — already serving at ${spec.healthUrl}, adopting (no spawn)`);
      _children.set(spec.name, {
        spec,
        proc: null,
        restarts: 0,
        lastStart: Date.now(),
        lastHealthy: Date.now(),
        healthy: true,
        gaveUp: false,
      });
      emit({ event: 'child_adopted', child: spec.name });
      return;
    }
  }
  console.log(`[supervisor] starting ${spec.name} (${spec.cmd} ${spec.args.join(' ')})`);
  const proc = _spawnChild(spec);
  _children.set(spec.name, {
    spec,
    proc,
    restarts: (existing ? existing.restarts : 0),
    lastStart: Date.now(),
    lastHealthy: 0,
    healthy: false,
    gaveUp: false,
  });
  emit({ event: 'child_started', child: spec.name, pid: proc.pid });
}

//  Health probing
function _probe(healthUrl) {
  return new Promise((resolve) => {
    const req = http.get(healthUrl, { timeout: 3000 }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function _healthLoop() {
  for (const spec of CHILDREN) {
    const state = _children.get(spec.name);
    if (!state) continue;

    const alive = state.proc && state.proc.exitCode === null;
    if (!alive) {
      // Before giving up or spawning a new one, check if something is already
      // serving on the health URL (e.g. a previous process that survived a proxy
      // restart). If healthy, adopt it — no spawn needed, reset restart counter.
      if (spec.healthUrl) {
        const alreadyServing = await _probe(spec.healthUrl);
        if (alreadyServing) {
          if (state.restarts > 0 || state.gaveUp) {
            console.log(`[supervisor] ${spec.name} — surviving process adopted at ${spec.healthUrl}, resetting restarts`);
            emit({ event: 'child_adopted', child: spec.name });
          }
          state.proc = null;
          state.restarts = 0;
          state.gaveUp = false;
          state.healthy = true;
          state.lastHealthy = Date.now();
          // Clear the abandon sentinel now that a healthy process is serving.
          try {
            const sentinel = path.join(PROJECT_ROOT, 'tmp', 'hme-supervisor-abandoned');
            if (fs.existsSync(sentinel)) fs.unlinkSync(sentinel);
          } catch (_e) { /* best-effort */ }
          continue;
        }
      }

      // Nothing serving — apply restart limit and backoff
      if (state.restarts >= spec.maxRestarts) {
        if (!state.gaveUp) {
          const errLog = path.join(PROJECT_ROOT, 'log', 'hme-errors.log');
          const sentinel = path.join(PROJECT_ROOT, 'tmp', 'hme-supervisor-abandoned');
          const msg = `[supervisor] ${spec.name} hit restart limit (${spec.maxRestarts}) — giving up`;
          // Tail of child stderr goes in the sentinel JSON (read by i/status),
          // NOT into hme-errors.log — one event must not flood the LIFESAVER
          // scanner with 20+ lines. hme-errors.log stays one-line-per-event.
          let childTail = '';
          let childLogPath = '';
          try {
            const childLog = path.join(PROJECT_ROOT, 'log', `hme-${spec.name}.out`);
            childLogPath = childLog;
            if (fs.existsSync(childLog)) {
              childTail = fs.readFileSync(childLog, 'utf8').split('\n').slice(-20).join('\n');
            }
          } catch (_e) { /* best-effort */ }
          console.error(msg);
          const tailHint = childLogPath ? ` (see tail in tmp/hme-supervisor-abandoned; full log: ${childLogPath})` : '';
          try { fs.appendFileSync(errLog, `[${new Date().toISOString()}] ${msg}${tailHint}\n`); } catch (_e) { /* best-effort */ }
          // Filesystem sentinel the i/ wrappers + statusline check for immediate surfacing.
          // Cleared on successful adoption (see the adopt path above).
          try {
            fs.mkdirSync(path.dirname(sentinel), { recursive: true });
            fs.writeFileSync(sentinel, JSON.stringify({
              child: spec.name,
              restarts: spec.maxRestarts,
              abandoned_at: new Date().toISOString(),
              message: msg,
              last_output: childTail
            }, null, 2));
          } catch (_e) { /* best-effort */ }
          emit({ event: 'child_restart_limit', child: spec.name });
          state.gaveUp = true;
        }
        continue;
      }
      const backoffMs = Math.min(spec.restartDelayMs * (1 + state.restarts * 0.5), 30_000);
      const timeSinceDeath = Date.now() - (state.lastStart + 1000);
      if (timeSinceDeath < backoffMs) continue; // wait for backoff
      console.log(`[supervisor] restarting ${spec.name} (attempt ${state.restarts + 1})`);
      state.restarts++;
      state.lastStart = Date.now();
      const proc = _spawnChild(spec);
      state.proc = proc;
      state.healthy = false;
      state.gaveUp = false;
      emit({ event: 'child_restarted', child: spec.name, attempt: state.restarts });
      continue;
    }

    // Process alive — check health URL
    const sinceStart = Date.now() - state.lastStart;
    if (sinceStart < spec.startupMs) continue; // still warming up

    const healthy = await _probe(spec.healthUrl);
    if (healthy) {
      state.restarts = 0;  // reset on confirmed health — stale count cleared
      state.gaveUp = false;
    }
    state.lastHealthy = healthy ? Date.now() : state.lastHealthy;

    if (!healthy && state.healthy) {
      // Was healthy, now isn't — log degradation
      console.warn(`[supervisor] ${spec.name} health degraded`);
      emit({ event: 'child_unhealthy', child: spec.name });
    }
    state.healthy = healthy;
  }
}

//  Restart API (for hang-kill)
function killChild(name, signal = 'SIGTERM') {
  const state = _children.get(name);
  if (!state || !state.proc) return false;
  try {
    process.kill(state.proc.pid, signal);
    console.log(`[supervisor] sent ${signal} to ${name} (pid ${state.proc.pid})`);
    return true;
  } catch (_e) {
    return false;
  }
}

function killAll(signal = 'SIGTERM') {
  for (const [name] of _children) killChild(name, signal);
}

function isHealthy(name) {
  const state = _children.get(name);
  return state ? state.healthy : false;
}

function status() {
  const out = {};
  for (const [name, state] of _children) {
    out[name] = {
      pid: state.proc ? state.proc.pid : null,
      alive: state.proc ? state.proc.exitCode === null : false,
      healthy: state.healthy,
      restarts: state.restarts,
      lastHealthy: state.lastHealthy,
    };
  }
  return out;
}

//  Startup
// Start children in order: shim first, then MCP (MCP depends on shim).
// healthLoop polls every 10s after initial startup delay.
let _started = false;

// Graceful shutdown — unified entry point for every signal/crash path.
// Idempotent: repeated calls (e.g. SIGTERM arriving while already draining)
// are no-ops. Drains the HTTP server if registered, kills children, exits.
let _shuttingDown = false;
let _httpServer = null;
const DRAIN_TIMEOUT_MS = 3000;

function registerServer(server) {
  _httpServer = server;
}

function _gracefulShutdown(reason, exitCode = 0) {
  if (_shuttingDown) return;
  _shuttingDown = true;
  console.error(`[supervisor] shutdown: ${reason}`);

  const finish = () => {
    killAll('SIGTERM');
    // Give children ~500ms to exit cleanly before we disappear.
    setTimeout(() => process.exit(exitCode), 500).unref();
  };

  if (_httpServer) {
    // Stop accepting new connections; let in-flight requests finish.
    let drained = false;
    _httpServer.close(() => {
      if (drained) return;
      drained = true;
      finish();
    });
    // Drain deadline — if connections hang (e.g. long SSE), force-exit anyway.
    setTimeout(() => {
      if (drained) return;
      drained = true;
      console.error(`[supervisor] drain deadline (${DRAIN_TIMEOUT_MS}ms) — force-closing`);
      finish();
    }, DRAIN_TIMEOUT_MS).unref();
  } else {
    finish();
  }
}

// Install process-wide shutdown handlers. Safe to call without start() — the
// drain logic doesn't depend on children existing. Should run in every mode
// (even SUPERVISE=0) so the proxy cleans up HTTP connections on signal/crash.
let _handlersInstalled = false;
function installShutdownHandlers() {
  if (_handlersInstalled) return;
  _handlersInstalled = true;

  // Fallback: if the process exits by any path we didn't catch below, still
  // try to take children down. Synchronous — event loop is closing here.
  process.on('exit', () => killAll('SIGTERM'));

  // Signal-driven shutdowns — all route through the unified drain path.
  process.on('SIGTERM', () => _gracefulShutdown('SIGTERM', 0));
  process.on('SIGINT',  () => _gracefulShutdown('SIGINT',  0));
  process.on('SIGHUP',  () => _gracefulShutdown('SIGHUP',  0));

  // Crash-driven shutdowns — log diagnostics, then drain cleanly. Without
  // these, a middleware crash leaves children orphaned and ports bound.
  process.on('uncaughtException', (err) => {
    console.error('[supervisor] uncaughtException:', err && err.stack || err);
    _gracefulShutdown('uncaughtException', 1);
  });
  process.on('unhandledRejection', (err) => {
    console.error('[supervisor] unhandledRejection:', err && err.stack || err);
    _gracefulShutdown('unhandledRejection', 1);
  });
}

function start() {
  if (_started) return;
  _started = true;
  // Start children sequentially (each awaits its own pre-flight health probe).
  (async () => {
    for (const spec of CHILDREN) {
      await _startChild(spec);
    }
  })().catch((err) => console.error('[supervisor] start sequence error:', err.message));
  // Health loop — starts after longest startup window
  const maxStartup = Math.max(...CHILDREN.map((c) => c.startupMs));
  setTimeout(() => {
    _healthLoop();
    setInterval(() => _healthLoop(), 10_000);
  }, maxStartup);
  installShutdownHandlers();
}

//  Ad-hoc process spawn (TTL-bounded, no restart)
// Exposed via /hme/spawn so Claude (or any other caller) can launch short-lived
// helpers without the Bash tool's run_in_background — no task-notification on
// exit, auto-reaped after ttl_sec, tracked by id.
const _adhoc = new Map();  // id → { spec, proc, startedAt, ttlSec }

function adhocSpawn({ name, cmd, args, env, cwd, ttl_sec }) {
  const id = (name || 'adhoc') + '_' + Math.random().toString(36).slice(2, 10);
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_e) { /* ignore */ }
  const logPath = path.join(LOG_DIR, `hme-adhoc-${id}.out`);
  const logFd = fs.openSync(logPath, 'a');
  const proc = spawn(cmd, args || [], {
    detached: false,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, ...(env || {}) },
    cwd: cwd || PROJECT_ROOT,
  });
  const ttlSec = Math.max(5, Math.min(3600, ttl_sec || 120));
  const state = { spec: { name, cmd, args }, proc, startedAt: Date.now(), ttlSec, logPath };
  _adhoc.set(id, state);
  proc.on('exit', () => { fs.closeSync(logFd); });
  // Auto-reap on TTL expiry — SIGTERM, then SIGKILL after 2s grace.
  setTimeout(() => {
    if (proc.exitCode !== null) return; // already exited
    try { process.kill(proc.pid, 'SIGTERM'); } catch (_e) { /* already exited */ }
    setTimeout(() => {
      if (proc.exitCode === null) {
        try { process.kill(proc.pid, 'SIGKILL'); } catch (_e) { /* already exited */ }
      }
    }, 2000);
  }, ttlSec * 1000);
  emit({ event: 'adhoc_spawn', id, cmd: (cmd || '').split('/').pop(), ttl_sec: ttlSec });
  return { id, pid: proc.pid, ttl_sec: ttlSec, logPath };
}

function adhocStatus(id) {
  const s = _adhoc.get(id);
  if (!s) return null;
  return {
    id,
    pid: s.proc.pid,
    alive: s.proc.exitCode === null,
    exit_code: s.proc.exitCode,
    uptime_sec: Math.floor((Date.now() - s.startedAt) / 1000),
    ttl_sec: s.ttlSec,
    log: s.logPath,
  };
}

function adhocKill(id, signal = 'SIGTERM') {
  const s = _adhoc.get(id);
  if (!s) return false;
  try { process.kill(s.proc.pid, signal); return true; } catch (_e) { return false; }
}

function adhocList() {
  const out = [];
  for (const id of _adhoc.keys()) out.push(adhocStatus(id));
  return out;
}

module.exports = { start, installShutdownHandlers, registerServer, killChild, killAll, isHealthy, status, adhocSpawn, adhocStatus, adhocKill, adhocList };
