#!/usr/bin/env node
'use strict';

// Slot watchdog: polls runtime/proxy-{a,b}.health every HME_PROXY_HEARTBEAT_SEC.
// When a slot's heartbeat is stale (> 3 * heartbeat_sec) OR the file is missing

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { loadEnv, requireEnv } = require('../shared/load_env');

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
  a: { missingSince: 0, respawnInFlight: false, lastRespawnTs: 0 },
  b: { missingSince: 0, respawnInFlight: false, lastRespawnTs: 0 },
};
const RESPAWN_COOLDOWN_MS = 30_000;

function _readJSONSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}

function _pidAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

function _shouldRespawn(slot) {
  const s = state[slot];
  const now = Date.now();
  const h = _readJSONSafe(HEALTH[slot]);
  if (!h) {
    if (!s.missingSince) s.missingSince = now;
    return (now - s.missingSince) >= STALE_MS;
  }
  s.missingSince = 0;
  const heartbeatAge = now - Number(h.ts || 0);
  if (heartbeatAge < STALE_MS) return false;
  if (_pidAlive(h.pid)) return false;
  return true;
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
  for (const slot of ['a', 'b']) {
    if (_shouldRespawn(slot)) {
      const h = _readJSONSafe(HEALTH[slot]);
      const reason = h ? `heartbeat ${Math.round((Date.now() - Number(h.ts || 0)) / 1000)}s stale, pid ${h.pid} dead` : `health file missing > ${Math.round(STALE_MS / 1000)}s`;
      _respawn(slot, reason);
    }
  }
}

let _lastGitDriftTriggerSlot = null;
let _lastGitDriftTriggerAt = 0;
function _gitDriftTick() {
  const head = _currentHeadSha();
  if (!head) return;
  const candidates = [];
  for (const slot of ['a', 'b']) {
    const h = _readJSONSafe(HEALTH[slot]);
    if (!h || !h.git_sha || h.git_sha === 'unknown') continue;
    if (h.git_sha !== head) candidates.push({ slot, slotSha: h.git_sha });
  }
  if (candidates.length === 0) return;
  if (_lastGitDriftTriggerSlot) {
    if ((Date.now() - _lastGitDriftTriggerAt) < GIT_DRIFT_INTERSLOT_DELAY_MS) return;
    const other = candidates.find((c) => c.slot !== _lastGitDriftTriggerSlot);
    if (other) {
      console.error(`[slot-watchdog] git drift continues: slot ${other.slot} on ${other.slotSha}, HEAD ${head}; chained restart`);
      _respawn(other.slot, `stale code (slot ${other.slotSha} vs HEAD ${head})`);
      _lastGitDriftTriggerSlot = other.slot;
      _lastGitDriftTriggerAt = Date.now();
    } else {
      _lastGitDriftTriggerSlot = null;
    }
    return;
  }
  const first = candidates[0];
  console.error(`[slot-watchdog] git drift detected: slot ${first.slot} on ${first.slotSha}, HEAD ${head}; restarting`);
  _respawn(first.slot, `stale code (slot ${first.slotSha} vs HEAD ${head})`);
  _lastGitDriftTriggerSlot = first.slot;
  _lastGitDriftTriggerAt = Date.now();
}

function start() {
  console.error(`[slot-watchdog] polling every ${POLL_MS}ms; stale threshold ${STALE_MS}ms; respawn cooldown ${RESPAWN_COOLDOWN_MS}ms; git-drift check every ${GIT_SHA_POLL_MS}ms`);
  setInterval(_tick, POLL_MS);
  setInterval(_gitDriftTick, GIT_SHA_POLL_MS);
}

start();
