#!/usr/bin/env node
'use strict';
// Watchdog-INDEPENDENT proxy liveness gate, run at turn start (UserPromptSubmit).
//

const fs = require('fs');
const path = require('path');

function _isAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

// Pure core: classify each slot. deps = { isAlive, staleMs }.
function evaluateSlots(slots, wantedFingerprint, now, deps) {
  const isAlive = (deps && deps.isAlive) || _isAlive;
  const staleMs = (deps && deps.staleMs) || 30_000;
  // Per-slot classification. A single slot being missing/dead/stale is NORMAL
  // during zero-downtime rotation (the watcher restarts one slot while the
  // other serves), so it is NOT alarm-worthy on its own. Two states ARE always
  let routableCurrent = 0;
  const drift = [];
  const down = [];
  for (const slot of ['a', 'b']) {
    const h = slots[slot];
    if (!h) { down.push({ slot, kind: 'missing', detail: 'health file missing/unreadable' }); continue; }
    if (!isAlive(h.pid)) { down.push({ slot, kind: 'dead', detail: `pid ${h.pid} not alive` }); continue; }
    if ((now - Number(h.ts || 0)) > staleMs) {
      down.push({ slot, kind: 'stale', detail: `heartbeat ${Math.round((now - Number(h.ts || 0)) / 1000)}s stale` });
      continue;
    }
    const have = String(h.runtime_fingerprint || '');
    if (wantedFingerprint && have && have !== wantedFingerprint) {
      drift.push({ slot, kind: 'drift', detail: `live=${have.slice(0, 12)} wanted=${wantedFingerprint.slice(0, 12)}` });
      continue;
    }
    routableCurrent += 1; // alive, fresh, current code
  }
  // Drift always alarms. Total outage (no routable-current slot) alarms.
  // A lone down slot while the other is routable-current is benign rotation.
  const problems = [...drift];
  if (routableCurrent === 0) problems.push(...down);
  return { ok: problems.length === 0, problems };
}

function formatLifesaver(problems) {
  if (!problems || problems.length === 0) return '';
  const ts = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const summary = problems.map((p) => `slot ${p.slot} ${p.kind} (${p.detail})`).join('; ');
  return `[${ts}] [proxy-liveness] LIFESAVER -- proxy is NOT serving current code: ${summary}. `
    + `Requests bypass all rewriters until slots converge. Restart the proxy supervisor before proceeding.`;
}

function _readJSONSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}

// Pure evaluation against the live health files. Returns { ok, problems }.
function inspectLive(root) {
  const runtimeDir = path.join(root, 'tools', 'HME', 'runtime');
  const slots = {
    a: _readJSONSafe(path.join(runtimeDir, 'proxy-a.health')),
    b: _readJSONSafe(path.join(runtimeDir, 'proxy-b.health')),
  };
  let wanted = '';
  try {
    const { currentRuntimeFingerprint } = require('./proxy_runtime_fingerprint');
    wanted = currentRuntimeFingerprint(root);
  } catch (_) { /* if fingerprint can't compute, skip the drift dimension */ }
  return evaluateSlots(slots, wanted, Date.now(), {});
}

// --check-only: exit non-zero on drift/outage, write nothing. For the
// SessionStart bootstrap to decide whether to auto-restart the supervisor.
function runCheckOnly(root) {
  return inspectLive(root).ok ? 0 : 1;
}

// CLI entry: read health files + fingerprint, append LIFESAVER to hme-errors.log
// if degraded. Exits 0 always (the hook scanner does the bannering).
function runCli(root) {
  const runtimeDir = path.join(root, 'tools', 'HME', 'runtime');
  const slots = {
    a: _readJSONSafe(path.join(runtimeDir, 'proxy-a.health')),
    b: _readJSONSafe(path.join(runtimeDir, 'proxy-b.health')),
  };
  let wanted = '';
  try {
    const { currentRuntimeFingerprint } = require('./proxy_runtime_fingerprint');
    wanted = currentRuntimeFingerprint(root);
  } catch (_) { /* if fingerprint can't compute, skip the drift dimension */ }
  const { ok, problems } = evaluateSlots(slots, wanted, Date.now(), {});
  if (ok) return 0;
  const line = formatLifesaver(problems);
  try {
    const logPath = path.join(root, 'log', 'hme-errors.log');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, line + '\n');
  } catch (_) { /* best-effort */ }
  try { process.stderr.write(line + '\n'); } catch (_) { /* best-effort */ }
  return 0;
}

module.exports = { evaluateSlots, formatLifesaver, runCli, runCheckOnly, inspectLive };

if (require.main === module) {
  const root = process.env.PROJECT_ROOT || path.resolve(__dirname, '..', '..', '..');
  const checkOnly = process.argv.includes('--check-only');
  process.exit(checkOnly ? runCheckOnly(root) : runCli(root));
}
