#!/usr/bin/env node
'use strict';

// Watches tools/HME/proxy/** for changes and triggers per-slot restart via
// polychron-slot-restart.sh, alternating slots so at least one always serves.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { loadEnv, requireEnv } = require('../shared/load_env');
const { watchSelfAndReexec } = require('./self_reexec');
const { extraRuntimeFiles } = require('../proxy_runtime_fingerprint');
const { createRestartCoordinator } = require('./restart_coordinator');

const ENV_FILE = path.resolve(__dirname, '..', '..', '..', '..', '.env');
const FILE_WATCHER_REEXEC_FILES = [
  path.join(__dirname, 'self_reexec.js'),
  path.join(__dirname, 'restart_coordinator.js'),
  path.join(__dirname, '..', 'proxy_runtime_fingerprint.js'),
  path.join(__dirname, '..', 'shared', 'load_env.js'),
  ENV_FILE,
];

loadEnv(ENV_FILE);

const PROJECT_ROOT = requireEnv('PROJECT_ROOT');
const WATCH_DIR = path.join(PROJECT_ROOT, 'tools', 'HME', 'proxy');
const SLOT_SCRIPT = path.join(PROJECT_ROOT, 'tools', 'HME', 'launcher', 'polychron-slot-restart.sh');
const DEBOUNCE_MS = 5000;
const SHUFFLER_OWN_DIR = path.join(WATCH_DIR, 'shuffler');
// Files OUTSIDE the proxy tree that still feed the runtime fingerprint (.env,
// launcher + supervisor scripts). If the watcher ignores these, a change flips
const EXTRA_WATCH_FILES = new Set(extraRuntimeFiles(PROJECT_ROOT));

const SKIP_PATTERNS = [
  /node_modules\//,
  /\.tmp$/,
  /\.swp$/,
  /\.swo$/,
  /~$/,
  /\.health$/,
  /\.flag$/,
  /\/runtime\//,
];

const restartCoordinator = createRestartCoordinator();
let pendingTimer = null;
let firstPendingAt = 0;        // when the current debounce window opened

function shouldRestart(filePath) {
  if (!filePath) return false;
  // Fingerprint-input files outside the proxy tree (.env, launcher/supervisor
  // shell scripts) must trigger rotation even though they fail the ext filter.
  if (EXTRA_WATCH_FILES.has(filePath)) return true;
  if (filePath.startsWith(SHUFFLER_OWN_DIR)) return false;
  for (const re of SKIP_PATTERNS) if (re.test(filePath)) return false;
  if (!/\.(js|mjs|cjs|json)$/.test(filePath)) return false;
  return true;
}

const MAX_DEBOUNCE_MS = 12000;   // hard ceiling: continuous churn can't starve a restart
function scheduleRestart(filePath) {
  const decision = restartCoordinator.onChange(filePath);
  if (!decision.schedule) {
    console.error(`[file-watcher] restart in-flight; queued re-trigger from ${path.relative(PROJECT_ROOT, filePath)}`);
    return;
  }
  const now = Date.now();
  if (!firstPendingAt) firstPendingAt = now;
  if (pendingTimer) clearTimeout(pendingTimer);
  // Normal 5s debounce, but clamp so a sliding window of constant edits
  // (autocommit fires often) still fires within MAX_DEBOUNCE_MS.
  const remainingCap = Math.max(0, MAX_DEBOUNCE_MS - (now - firstPendingAt));
  const wait = Math.min(DEBOUNCE_MS, remainingCap);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    firstPendingAt = 0;
    const restart = restartCoordinator.onDebounceElapsed();
    if (restart) runRestart(restart);
  }, wait);
}

function runRestart(restart) {
  const { slot, path: triggerPath } = restart;
  console.error(`[file-watcher] proxy change detected (${path.relative(PROJECT_ROOT, triggerPath)}); restarting slot ${slot}`);
  // Force: debounce + in-flight serialization already bound code-change churn.
  const proc = spawn('bash', [SLOT_SCRIPT, '--slot', slot, '--force'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  proc.on('exit', (code) => {
    if (code !== 0) {
      // GUARANTEE 3 (no breakage on >1 slot): the slot we just rolled did NOT
      // come up viable (preflight/admission/ready-wait failed in slot-restart).
      console.error(`[file-watcher] slot-restart ${slot} exited ${code}; leaving the other slot on last-viable code (check log/hme-proxy-${slot}.out)`);
      restartCoordinator.onRestartDone({ failed: true, clearPending: true });
      return;
    }
    const chained = restartCoordinator.onRestartDone();
    if (chained) {
      // A change landed mid-restart AND this slot proved viable -> restart the
      // OTHER slot now so both converge to current code. Zero-downtime: this
      runRestart(chained);
    }
  });
}

function _walkRegister(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (p.startsWith(SHUFFLER_OWN_DIR)) continue;
      if (/node_modules|\/runtime\//.test(p)) continue;
      _walkRegister(p);
    }
  }
}

// Scan proxy/**/*.js for require() escapes (paths that resolve OUTSIDE WATCH_DIR).
// These external files are loaded into the proxy process and changes to them
function discoverExternalDeps() {
  const REQ_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  const external = new Set();
  function scanFile(absFile) {
    let txt; try { txt = fs.readFileSync(absFile, 'utf8'); } catch (_) { return; }
    REQ_RE.lastIndex = 0;
    let m;
    while ((m = REQ_RE.exec(txt))) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue;
      const resolved = path.resolve(path.dirname(absFile), spec);
      if (resolved.startsWith(WATCH_DIR + path.sep)) continue;
      const candidates = [resolved, `${resolved}.js`, `${resolved}.json`, path.join(resolved, 'index.js')];
      for (const c of candidates) {
        try { if (fs.statSync(c).isFile()) { external.add(c); break; } } catch (_) { /* not this candidate */ }
      }
    }
  }
  function walk(dir) {
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (p.startsWith(SHUFFLER_OWN_DIR)) continue;
        if (/node_modules|\/runtime\//.test(p)) continue;
        walk(p);
      } else if (/\.(js|mjs|cjs)$/.test(e.name)) {
        scanFile(p);
      }
    }
  }
  walk(WATCH_DIR);
  return [...external];
}

// Polling-based file watcher: uses fs.statSync every POLL_INTERVAL_MS to
// detect mtime changes. Avoids the inotify kernel watch limit (ENOSPC) that
const POLL_INTERVAL_MS = 2000;

function _enumerateAllWatchedFiles() {
  const files = new Set();
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (p.startsWith(SHUFFLER_OWN_DIR)) continue;
        if (/node_modules|\/runtime\//.test(p)) continue;
        walk(p);
      } else if (e.isFile() && /\.(js|mjs|cjs|json)$/.test(e.name)) {
        files.add(p);
      }
    }
  }
  walk(WATCH_DIR);
  for (const ext of discoverExternalDeps()) files.add(ext);
  // Fingerprint-input files outside the proxy tree -- poll them too so a change
  // to .env / launcher / supervisor actually rotates the slots.
  for (const extra of EXTRA_WATCH_FILES) files.add(extra);
  return [...files];
}

function start() {
  watchSelfAndReexec(__filename, FILE_WATCHER_REEXEC_FILES);
  if (!fs.existsSync(WATCH_DIR)) {
    console.error(`[file-watcher] watch dir missing: ${WATCH_DIR}`);
    process.exit(1);
  }
  const mtimes = new Map();
  const watched = _enumerateAllWatchedFiles();
  for (const p of watched) {
    try { mtimes.set(p, fs.statSync(p).mtimeMs); } catch (_) { /* file may vanish */ }
  }
  let lastRescan = Date.now();
  const RESCAN_INTERVAL_MS = 30000;
  setInterval(() => {
    if (Date.now() - lastRescan >= RESCAN_INTERVAL_MS) {
      lastRescan = Date.now();
      for (const p of _enumerateAllWatchedFiles()) {
        if (!mtimes.has(p)) {
          try { mtimes.set(p, fs.statSync(p).mtimeMs); } catch (_) { /* file may vanish */ }
        }
      }
    }
    for (const [p, prevMtime] of mtimes) {
      let stat;
      try { stat = fs.statSync(p); }
      catch (_) { mtimes.delete(p); continue; }
      if (stat.mtimeMs !== prevMtime) {
        mtimes.set(p, stat.mtimeMs);
        if (shouldRestart(p)) scheduleRestart(p);
      }
    }
  }, POLL_INTERVAL_MS);
  const externals = discoverExternalDeps();
  console.error(`[file-watcher] polling ${watched.length} files every ${POLL_INTERVAL_MS}ms (debounce ${DEBOUNCE_MS}ms, alternating slots a/b) + ${externals.length} external dep(s) -- inotify-free`);
  for (const e of externals) console.error(`[file-watcher]   external: ${path.relative(PROJECT_ROOT, e)}`);
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT',  () => process.exit(0));
}

module.exports = {
  shouldRestart,
  _enumerateAllWatchedFiles,
  EXTRA_WATCH_FILES,
  FILE_WATCHER_REEXEC_FILES,
  start,
};

// Only run the live watcher when invoked directly, not when required by tests.
if (require.main === module) start();
