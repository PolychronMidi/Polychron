#!/usr/bin/env node
'use strict';

// Slot watchdog: polls runtime/proxy-{a,b}.health every HME_PROXY_HEARTBEAT_SEC.
// When a slot's heartbeat is stale (> 3 * heartbeat_sec) OR the file is missing

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
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
const DRIFT_RESPAWN_GAP_MS = Math.max(35_000, RESPAWN_COOLDOWN_MS);
let lastDriftRespawnTs = 0;
let cachedHead = { ts: 0, sha: '' };

function _currentRepoGitSha() {
  const now = Date.now();
  if (cachedHead.sha && (now - cachedHead.ts) < 2000) return cachedHead.sha;
  try {
    cachedHead = {
      ts: now,
      sha: execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        timeout: 1000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim(),
    };
  } catch (_) {
    cachedHead = { ts: now, sha: '' };
  }
  return cachedHead.sha;
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
  const wanted = _currentRepoGitSha();
  const have = String(h.git_sha || '').slice(0, 12);
  if (wanted && have && have !== wanted) {
    return { yes: true, kind: 'drift', reason: `git_sha drift live=${have} wanted=${wanted}` };
  }
  return { yes: false };
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
    const decision = _respawnDecision(slot);
    if (!decision.yes) continue;
    if (decision.kind === 'drift') {
      if ((now - lastDriftRespawnTs) < DRIFT_RESPAWN_GAP_MS) continue;
      lastDriftRespawnTs = now;
    }
    _respawn(slot, decision.reason);
    if (decision.kind === 'drift') break;
  }
}

function start() {
  console.error(`[slot-watchdog] polling every ${POLL_MS}ms; stale threshold ${STALE_MS}ms; respawn cooldown ${RESPAWN_COOLDOWN_MS}ms; drift gap ${DRIFT_RESPAWN_GAP_MS}ms`);
  setInterval(_tick, POLL_MS);
}

start();
