'use strict';

// Active-active proxy slot lifecycle: heartbeat writer, drain-flag watcher,
// in-flight tracking. When HME_PROXY_SLOT={a,b} is set, hme_proxy.js binds the

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { requireEnv } = require('./shared/load_env');
const { computeRuntimeFingerprint } = require('./proxy_runtime_fingerprint');

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
    markReady() { ready = true; writeHeartbeat(); },
    isReady() { return ready; },
    isDraining() { return draining; },
    inFlight() { return inFlight; },
  };
}

module.exports = { slotConfig, attachSlotLifecycle };
