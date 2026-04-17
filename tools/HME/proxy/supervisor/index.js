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

// ── Supervisor state ─────────────────────────────────────────────────────────
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

function _startChild(spec) {
  const existing = _children.get(spec.name);
  if (existing && existing.proc && existing.proc.exitCode === null) {
    return; // already running
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
  });
  emit({ event: 'child_started', child: spec.name, pid: proc.pid });
}

// ── Health probing ──────────────────────────────────────────────────────────
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
      // Process is dead — restart with backoff
      if (state.restarts >= spec.maxRestarts) {
        const errLog = path.join(PROJECT_ROOT, 'log', 'hme-errors.log');
        const msg = `[supervisor] ${spec.name} hit restart limit (${spec.maxRestarts}) — giving up`;
        console.error(msg);
        try { fs.appendFileSync(errLog, `[${new Date().toISOString()}] ${msg}\n`); } catch (_e) {}
        emit({ event: 'child_restart_limit', child: spec.name });
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
      emit({ event: 'child_restarted', child: spec.name, attempt: state.restarts });
      continue;
    }

    // Process alive — check health URL
    const sinceStart = Date.now() - state.lastStart;
    if (sinceStart < spec.startupMs) continue; // still warming up

    const healthy = await _probe(spec.healthUrl);
    state.lastHealthy = healthy ? Date.now() : state.lastHealthy;

    if (!healthy && state.healthy) {
      // Was healthy, now isn't — log degradation
      console.warn(`[supervisor] ${spec.name} health degraded`);
      emit({ event: 'child_unhealthy', child: spec.name });
    }
    state.healthy = healthy;
  }
}

// ── Restart API (for hang-kill) ──────────────────────────────────────────────
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

// ── Startup ─────────────────────────────────────────────────────────────────
// Start children in order: shim first, then MCP (MCP depends on shim).
// healthLoop polls every 10s after initial startup delay.
let _started = false;

function start() {
  if (_started) return;
  _started = true;
  // Start shim first
  for (const spec of CHILDREN) {
    _startChild(spec);
  }
  // Health loop — starts after longest startup window
  const maxStartup = Math.max(...CHILDREN.map((c) => c.startupMs));
  setTimeout(() => {
    _healthLoop();
    setInterval(() => _healthLoop(), 10_000);
  }, maxStartup);

  // Ensure children die with the proxy
  process.on('exit', () => killAll('SIGTERM'));
  process.on('SIGTERM', () => { killAll('SIGTERM'); process.exit(0); });
  process.on('SIGINT', () => { killAll('SIGTERM'); process.exit(0); });
}

// ── Ad-hoc process spawn (TTL-bounded, no restart) ──────────────────────────
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
    try { process.kill(proc.pid, 'SIGTERM'); } catch (_e) {}
    setTimeout(() => {
      if (proc.exitCode === null) {
        try { process.kill(proc.pid, 'SIGKILL'); } catch (_e) {}
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

module.exports = { start, killChild, killAll, isHealthy, status, adhocSpawn, adhocStatus, adhocKill, adhocList };
