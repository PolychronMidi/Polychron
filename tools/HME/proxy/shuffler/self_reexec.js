'use strict';
// Fail-safe self-reload for long-lived shuffler procs. Each proc polls its own
// source (and deps) for mtime changes and re-execs WHEN they change -- but only

const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const path = require('path');

const { requireEnv } = require('../shared/load_env');

const ERR_LOG_REL = path.join('log', 'hme-errors.log');

function _defaultCheckSyntax(entryFile) {
  const r = spawnSync(process.execPath, ['--check', entryFile], { encoding: 'utf8' });
  if (r.status === 0) return { ok: true };
  return { ok: false, error: ((r.stderr || r.stdout || 'node --check failed').split('\n')[0]).trim() };
}

function _defaultSpawn(entryFile, argv) {
  const child = spawn(process.execPath, [entryFile, ...argv], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: 'inherit',
    detached: true,
  });
  child.unref();
  return child;
}

function _defaultIsAlive(child) {
  if (!child || typeof child.pid !== 'number') return false;
  try { process.kill(child.pid, 0); return true; } catch (_) { return false; }
}

function _defaultAlert(line) {
  const root = requireEnv('PROJECT_ROOT');
  try {
    const p = path.join(root, ERR_LOG_REL);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, line + '\n');
  } catch (_) { /* best-effort */ }
  try { console.error(line); } catch (_) { /* best-effort */ }
}

function _ts() {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
}

// Pure, fully injectable core. Returns a verdict object; never throws.
async function performReexec(entryFile, argv = [], deps = {}) {
  const checkSyntax = deps.checkSyntax || (() => _defaultCheckSyntax(entryFile));
  const spawnFn = deps.spawnFn || (() => _defaultSpawn(entryFile, argv));
  const isAlive = deps.isAlive || _defaultIsAlive;
  const exitFn = deps.exitFn || ((code) => process.exit(code));
  const logFn = deps.logFn || ((m) => { try { console.error(m); } catch (_) { /* noop */ } });
  const alertFn = deps.alertFn || _defaultAlert;
  const sleep = deps.sleep || ((ms) => new Promise((res) => setTimeout(res, ms)));
  const graceMs = typeof deps.graceMs === 'number' ? deps.graceMs : 1500;

  // 1. Never spawn known-broken code -- keep the working old proc.
  const syntax = checkSyntax(entryFile);
  if (!syntax.ok) {
    alertFn(`[${_ts()}] [shuffler] LIFESAVER -- self-reexec ABORTED for ${entryFile}: new code failed syntax check (${syntax.error}); keeping old proc alive, NOT reloading.`);
    return { action: 'aborted', reason: `syntax: ${syntax.error}` };
  }

  // 2. Spawn the replacement, then wait a grace window.
  logFn(`[self-reexec] ${entryFile} changed; spawning replacement and verifying liveness`);
  let child;
  try { child = spawnFn(); } catch (err) {
    alertFn(`[${_ts()}] [shuffler] LIFESAVER -- self-reexec ABORTED for ${entryFile}: spawn threw (${err && err.message}); keeping old proc alive.`);
    return { action: 'aborted', reason: `spawn-threw: ${err && err.message}` };
  }
  await sleep(graceMs);

  // 3. Only step down the old proc if the child survived the grace window.
  if (!isAlive(child)) {
    alertFn(`[${_ts()}] [shuffler] LIFESAVER -- self-reexec ABORTED for ${entryFile}: replacement child died/crashed within ${graceMs}ms; keeping old proc alive.`);
    return { action: 'aborted', reason: 'child-died-in-grace' };
  }
  logFn(`[self-reexec] replacement confirmed alive; old proc stepping down`);
  exitFn(0);
  return { action: 'exited' };
}

function watchSelfAndReexec(entryFile, extraFiles = [], pollMs = 3000) {
  const files = [entryFile, ...extraFiles];
  const mtimes = new Map();
  for (const f of files) {
    try { mtimes.set(f, fs.statSync(f).mtimeMs); } catch (_) { mtimes.set(f, 0); }
  }
  let reexecInFlight = false;
  const timer = setInterval(async () => {
    if (reexecInFlight) return;
    for (const f of files) {
      let cur = 0;
      try { cur = fs.statSync(f).mtimeMs; } catch (_) { continue; }
      if (mtimes.get(f) && cur !== mtimes.get(f)) {
        reexecInFlight = true;
        const verdict = await performReexec(entryFile, process.argv.slice(2));
        if (verdict.action === 'exited') {
          clearInterval(timer);
          return;
        }
        // Aborted: record the new mtime so we don't re-attempt every poll on
        // the same broken edit; a subsequent (fixed) save bumps mtime again.
        mtimes.set(f, cur);
        reexecInFlight = false;
        return;
      }
    }
  }, pollMs);
  timer.unref();
}

module.exports = { watchSelfAndReexec, performReexec };
