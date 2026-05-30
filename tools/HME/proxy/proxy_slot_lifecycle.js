'use strict';

// Active-active proxy slot lifecycle: heartbeat writer, drain-flag watcher,
// in-flight tracking. When HME_PROXY_SLOT={a,b} is set, hme_proxy.js binds the

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { requireEnv } = require('./shared/load_env');
const { computeRuntimeFingerprint } = require('./proxy_runtime_fingerprint');

const STATE_SCHEMA_VERSION = 1;

function slotStateFile(runtimeDir) {
  return path.join(runtimeDir, 'proxy-slot-state.json');
}

function _readJSONSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function readSlotState(runtimeDir) {
  const state = _readJSONSafe(slotStateFile(runtimeDir));
  if (state && typeof state === 'object' && state.slots && typeof state.slots === 'object') return state;
  return { schema: STATE_SCHEMA_VERSION, slots: {}, history: [] };
}

function writeSlotState(runtimeDir, mutator) {
  const file = slotStateFile(runtimeDir);
  let state = readSlotState(runtimeDir);
  state.schema = STATE_SCHEMA_VERSION;
  state.slots = state.slots && typeof state.slots === 'object' ? state.slots : {};
  state.history = Array.isArray(state.history) ? state.history : [];
  state = mutator(state) || state;
  state.history = Array.isArray(state.history) ? state.history.slice(-100) : [];
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, file);
    return true;
  } catch (_) { return false; }
}

function recordSlotEvent(runtimeDir, slot, event, extra = {}) {
  return writeSlotState(runtimeDir, (state) => {
    const prior = state.slots[slot] && typeof state.slots[slot] === 'object' ? state.slots[slot] : {};
    const rec = {
      ...prior,
      slot,
      ...extra,
      last_event: event,
      updated_at: new Date().toISOString(),
    };
    state.slots[slot] = rec;
    state.history.push({ slot, event, ...extra, ts: rec.updated_at });
    return state;
  });
}

function latestBrokenFingerprint(runtimeDir) {
  const state = readSlotState(runtimeDir);
  const counts = new Map();
  for (const rec of Object.values(state.slots || {})) {
    if (!rec || rec.status !== 'broken' || !rec.runtime_fingerprint) continue;
    counts.set(rec.runtime_fingerprint, (counts.get(rec.runtime_fingerprint) || 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [fingerprint, count] of counts) {
    if (count > bestCount) { best = fingerprint; bestCount = count; }
  }
  return best;
}

function countSlotsWithFingerprint(runtimeDir, fingerprint, opts = {}) {
  if (!fingerprint) return 0;
  const slots = opts.slots || ['a', 'b'];
  const healthFile = (slot) => (opts.healthFile ? opts.healthFile(slot) : path.join(runtimeDir, `proxy-${slot}.health`));
  const isAlive = opts.isAlive || ((pid) => {
    if (!pid || typeof pid !== 'number') return false;
    try { process.kill(pid, 0); return true; } catch (_) { return false; }
  });
  const staleMs = Number(opts.staleMs || process.env.HME_PROXY_HEARTBEAT_STALE_MS || 5000);
  const now = Number(opts.now || Date.now());
  let count = 0;
  for (const slot of slots) {
    const h = _readJSONSafe(healthFile(slot));
    if (!h || h.runtime_fingerprint !== fingerprint) continue;
    if (h.draining || !h.ready) continue;
    if ((now - Number(h.ts || 0)) > staleMs) continue;
    if (!isAlive(h.pid)) continue;
    count += 1;
  }
  return count;
}

function canAdmitFingerprint(runtimeDir, fingerprint, opts = {}) {
  if (!fingerprint) return { ok: true, reason: '' };
  const broken = latestBrokenFingerprint(runtimeDir);
  if (broken && broken === fingerprint) {
    return { ok: false, reason: `runtime fingerprint ${fingerprint} is quarantined from prior failed slot admission` };
  }
  const maxSlots = Number(opts.maxSlots || 1);
  const liveCount = countSlotsWithFingerprint(runtimeDir, fingerprint, opts);
  if (liveCount >= maxSlots) {
    return { ok: false, reason: `runtime fingerprint ${fingerprint} already admitted on ${liveCount} live slot(s)` };
  }
  return { ok: true, reason: '' };
}

function markSlotStarting(runtimeDir, slot, fingerprint, extra = {}) {
  return recordSlotEvent(runtimeDir, slot, 'starting', { status: 'starting', runtime_fingerprint: fingerprint, ...extra });
}

function markSlotViable(runtimeDir, slot, fingerprint, extra = {}) {
  return recordSlotEvent(runtimeDir, slot, 'viable', { status: 'viable', runtime_fingerprint: fingerprint, ...extra });
}

function markSlotBroken(runtimeDir, slot, fingerprint, reason, extra = {}) {
  return recordSlotEvent(runtimeDir, slot, 'broken', { status: 'broken', runtime_fingerprint: fingerprint, reason: String(reason || 'unknown'), ...extra });
}

function clearSlotState(runtimeDir, slot, reason = '') {
  return recordSlotEvent(runtimeDir, slot, 'cleared', { status: 'unknown', reason });
}

function resetFingerprintState(runtimeDir, fingerprint, reason = '') {
  if (!fingerprint) return false;
  return writeSlotState(runtimeDir, (state) => {
    for (const [slot, rec] of Object.entries(state.slots || {})) {
      if (rec && rec.runtime_fingerprint === fingerprint) {
        state.slots[slot] = { ...rec, status: 'unknown', reason, updated_at: new Date().toISOString() };
      }
    }
    state.history.push({ event: 'fingerprint_reset', runtime_fingerprint: fingerprint, reason, ts: new Date().toISOString() });
    return state;
  });
}

let _CACHED_GIT_SHA = '';
let _CACHED_RUNTIME_FINGERPRINT = '';
function _resolveGitSha(projectRoot) {
  if (_CACHED_GIT_SHA) return _CACHED_GIT_SHA;
  try {
    _CACHED_GIT_SHA = execSync('git rev-parse HEAD', { cwd: projectRoot, encoding: 'utf8', timeout: 1000 }).trim().slice(0, 12);
  } catch (_) { _CACHED_GIT_SHA = 'unknown'; }
  return _CACHED_GIT_SHA;
}

function _resolveRuntimeFingerprint(projectRoot) {
  if (_CACHED_RUNTIME_FINGERPRINT) return _CACHED_RUNTIME_FINGERPRINT;
  try { _CACHED_RUNTIME_FINGERPRINT = computeRuntimeFingerprint(projectRoot); }
  catch (_) { _CACHED_RUNTIME_FINGERPRINT = 'unknown'; }
  return _CACHED_RUNTIME_FINGERPRINT;
}

function slotConfig() {
  const slot = process.env.HME_PROXY_SLOT;
  if (!slot || (slot !== 'a' && slot !== 'b')) return null;
  const projectRoot = requireEnv('PROJECT_ROOT');
  const backendPort = Number(process.env.HME_PROXY_BACKEND_PORT_OVERRIDE || requireEnv(slot === 'a' ? 'HME_PROXY_BACKEND_A_PORT' : 'HME_PROXY_BACKEND_B_PORT'));
  const heartbeatSec = Number(requireEnv('HME_PROXY_HEARTBEAT_SEC'));
  const drainTimeoutSec = Number(requireEnv('HME_PROXY_DRAIN_TIMEOUT_SEC'));
  const runtimeDir = path.join(projectRoot, 'tools', 'HME', 'runtime');
  return {
    slot,
    port: backendPort,
    heartbeatMs: Math.max(250, heartbeatSec * 1000),
    drainTimeoutMs: Math.max(1000, drainTimeoutSec * 1000),
    healthFile: process.env.HME_PROXY_HEALTH_FILE_OVERRIDE || path.join(runtimeDir, `proxy-${slot}.health`),
    drainFlagFile: process.env.HME_PROXY_DRAIN_FLAG_OVERRIDE || path.join(runtimeDir, `proxy-${slot}.drain.flag`),
    runtimeDir,
    projectRoot,
    gitSha: _resolveGitSha(projectRoot),
    runtimeFingerprint: _resolveRuntimeFingerprint(projectRoot),
  };
}

function attachSlotLifecycle(server, cfg) {
  if (!cfg) return null;
  let inFlight = 0;
  let ready = false;
  let draining = false;
  let drainStartedAt = 0;

  try { fs.mkdirSync(cfg.runtimeDir, { recursive: true }); } catch (_) { /* runtime dir already exists */ }

  function writeHeartbeat() {
    const payload = {
      pid: process.pid,
      ts: Date.now(),
      ready,
      draining,
      in_flight: inFlight,
      port: cfg.port,
      slot: cfg.slot,
      git_sha: cfg.gitSha,
      runtime_fingerprint: cfg.runtimeFingerprint,
    };
    try {
      const tmp = `${cfg.healthFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload));
      fs.renameSync(tmp, cfg.healthFile);
    } catch (_) { /* heartbeat is best-effort; shuffler treats stale files as down */ }
  }

  function checkDrainFlag() {
    if (draining) return;
    let exists = false;
    try { exists = fs.existsSync(cfg.drainFlagFile); } catch (_) { exists = false; }
    if (exists) {
      draining = true;
      drainStartedAt = Date.now();
      console.error(`[proxy-slot:${cfg.slot}] drain flag observed; refusing new connections, waiting for in_flight=${inFlight} to clear`);
    }
  }

  function maybeExitOnDrain() {
    if (!draining) return;
    const elapsed = Date.now() - drainStartedAt;
    if (inFlight === 0 || elapsed >= cfg.drainTimeoutMs) {
      console.error(`[proxy-slot:${cfg.slot}] drain complete (in_flight=${inFlight}, elapsed=${elapsed}ms); exiting`);
      try { fs.unlinkSync(cfg.healthFile); } catch (_) { /* health file already removed */ }
      try { fs.unlinkSync(cfg.drainFlagFile); } catch (_) { /* drain flag already removed */ }
      process.exit(0);
    }
  }

  server.on('request', (req, res) => {
    if (draining) {
      res.writeHead(503, { 'content-type': 'application/json', 'x-hme-proxy-slot': cfg.slot, 'x-hme-proxy-draining': '1' });
      res.end(JSON.stringify({ error: { type: 'slot_draining', message: `proxy slot ${cfg.slot} is draining` } }));
      return;
    }
    inFlight += 1;
    res.on('close', () => { inFlight = Math.max(0, inFlight - 1); });
    res.on('finish', () => { inFlight = Math.max(0, inFlight - 1); });
  });

  setInterval(() => {
    checkDrainFlag();
    writeHeartbeat();
    maybeExitOnDrain();
  }, cfg.heartbeatMs).unref();

  process.on('SIGTERM', () => {
    draining = true; drainStartedAt = Date.now();
    writeHeartbeat();
  });

  return {
    markReady() {
      ready = true;
      markSlotViable(cfg.runtimeDir, cfg.slot, cfg.runtimeFingerprint, { pid: process.pid, git_sha: cfg.gitSha, port: cfg.port });
      writeHeartbeat();
    },
    isReady() { return ready; },
    isDraining() { return draining; },
    inFlight() { return inFlight; },
  };
}

module.exports = {
  slotConfig,
  attachSlotLifecycle,
  slotStateFile,
  readSlotState,
  writeSlotState,
  recordSlotEvent,
  latestBrokenFingerprint,
  countSlotsWithFingerprint,
  canAdmitFingerprint,
  markSlotStarting,
  markSlotViable,
  markSlotBroken,
  clearSlotState,
  resetFingerprintState,
};
