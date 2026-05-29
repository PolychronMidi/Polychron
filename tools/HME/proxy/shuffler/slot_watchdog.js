#!/usr/bin/env node
'use strict';

// Slot watchdog: polls runtime/proxy-{a,b}.health every HME_PROXY_HEARTBEAT_SEC.
// When a slot's heartbeat is stale (> 3 * heartbeat_sec) OR the file is missing

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { loadEnv, requireEnv } = require('../shared/load_env');
const { currentRuntimeFingerprint } = require('../proxy_runtime_fingerprint');

loadEnv(path.resolve(__dirname, '..', '..', '..', '..', '.env'));

const PROJECT_ROOT = requireEnv('PROJECT_ROOT');
const HEARTBEAT_SEC = Number(requireEnv('HME_PROXY_HEARTBEAT_SEC'));
const STALE_FACTOR = 3;
const STALE_MS = Math.max(3000, HEARTBEAT_SEC * 1000 * STALE_FACTOR);
const POLL_MS = Math.max(1000, HEARTBEAT_SEC * 1000);
const SLOT_SCRIPT = path.join(PROJECT_ROOT, 'tools', 'HME', 'launcher', 'polychron-slot-restart.sh');
const RUNTIME_DIR = path.join(PROJECT_ROOT, 'tools', 'HME', 'runtime');
const HEALTH = {
  a: path.join(RUNTIME_DIR, 'proxy-a.health'),
  b: path.join(RUNTIME_DIR, 'proxy-b.health'),
};

const state = {
  a: { missingSince: 0, respawnInFlight: false, lastRespawnTs: 0, driftSince: 0, alerted: false },
  b: { missingSince: 0, respawnInFlight: false, lastRespawnTs: 0, driftSince: 0, alerted: false },
};
const RESPAWN_COOLDOWN_MS = 30_000;
// A slot stranded on old code past this long means the shuffler failed its
// one job (immediate liveness on both slots) -> LIFESAVER alert.
const DRIFT_ALERT_MS = 120_000;
const ERR_LOG = path.join(PROJECT_ROOT, 'log', 'hme-errors.log');
let cachedFingerprint = { ts: 0, value: '' };

function _currentRuntimeFingerprint() {
  const now = Date.now();
  if (cachedFingerprint.value && (now - cachedFingerprint.ts) < 2000) return cachedFingerprint.value;
  cachedFingerprint = { ts: now, value: currentRuntimeFingerprint(PROJECT_ROOT) };
  return cachedFingerprint.value;
}

function _readJSONSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}

function _pidAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

function _respawnDecision(slot) {
  const s = state[slot];
  const now = Date.now();
  const h = _readJSONSafe(HEALTH[slot]);
  if (!h) {
    if (!s.missingSince) s.missingSince = now;
    if ((now - s.missingSince) >= STALE_MS) {
      return { yes: true, kind: 'missing', reason: `health file missing > ${Math.round(STALE_MS / 1000)}s` };
    }
    return { yes: false };
  }
  s.missingSince = 0;
  const heartbeatAge = now - Number(h.ts || 0);
  if (heartbeatAge >= STALE_MS && !_pidAlive(h.pid)) {
    return { yes: true, kind: 'dead', reason: `heartbeat ${Math.round(heartbeatAge / 1000)}s stale, pid ${h.pid} dead` };
  }
  const wanted = _currentRuntimeFingerprint();
  const have = String(h.runtime_fingerprint || '');
  if (wanted && have && have !== wanted) {
    return { yes: true, kind: 'drift', reason: `runtime fingerprint drift live=${have.slice(0, 12)} wanted=${wanted.slice(0, 12)}` };
  }
  return { yes: false };
}

function _alertStaleSlot(slot, reason) {
  const ts = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const line = `[${ts}] [shuffler] LIFESAVER slot ${slot} stranded on stale code > `
    + `${Math.round(DRIFT_ALERT_MS / 1000)}s (${reason}); dual-slot liveness broken -- `
    + `live requests may hit old proxy code. Investigate slot-restart throttle/cooldown.\n`;
  try { fs.mkdirSync(path.dirname(ERR_LOG), { recursive: true }); fs.appendFileSync(ERR_LOG, line); }
  catch (_) { /* best-effort */ }
  console.error(line.trim());
}

function _respawn(slot, reason) {
  const s = state[slot];
  const now = Date.now();
  if (s.respawnInFlight) return;
  if ((now - s.lastRespawnTs) < RESPAWN_COOLDOWN_MS) return;
  s.respawnInFlight = true;
  s.lastRespawnTs = now;
  console.error(`[slot-watchdog] slot ${slot} ${reason}; respawning via polychron-slot-restart.sh --slot ${slot} --force`);
  const proc = spawn('bash', [SLOT_SCRIPT, '--slot', slot, '--force'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  proc.on('exit', (code) => {
    state[slot].respawnInFlight = false;
    state[slot].missingSince = 0;
    if (code !== 0) console.error(`[slot-watchdog] slot ${slot} respawn exited ${code}; tail log/hme-proxy-${slot}.out`);
  });
}

function _tick() {
  const now = Date.now();
  for (const slot of ['a', 'b']) {
    const s = state[slot];
    const decision = _respawnDecision(slot);
    if (!decision.yes) {
      s.driftSince = 0;
      s.alerted = false;
      continue;
    }
    if (decision.kind === 'drift') {
      if (!s.driftSince) s.driftSince = now;
      // Stranded too long despite respawn attempts -> LIFESAVER (once per episode).
      if (!s.alerted && (now - s.driftSince) >= DRIFT_ALERT_MS) {
        s.alerted = true;
        _alertStaleSlot(slot, decision.reason);
      }
    }
    // Per-slot cooldown inside _respawn serializes; no global gate, so both
    // slots can heal in the same sweep instead of starving one another.
    _respawn(slot, decision.reason);
  }
}

function start() {
  console.error(`[slot-watchdog] polling every ${POLL_MS}ms; stale threshold ${STALE_MS}ms; respawn cooldown ${RESPAWN_COOLDOWN_MS}ms; drift gap ${DRIFT_RESPAWN_GAP_MS}ms`);
  setInterval(_tick, POLL_MS);
}

start();
