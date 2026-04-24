'use strict';
// proxy_autocommit.js — request-driven autocommit middleware.
//
// Fail-fast-hardened. Writes to the SAME state files as
// tools/HME/hooks/helpers/_autocommit.sh so the AutocommitHealthVerifier
// sees failures regardless of which code path fired. Previously this
// module had `if (!root) return;` — the exact structural-dampening
// failure mode the system has been hit by repeatedly.

const fs = require('fs');
const path = require('path');
const { execSync, spawn, spawnSync } = require('child_process');

const ERR_LOG = 'log/hme-errors.log';
const STATE_DIR = 'tmp';
const FAIL_FLAG_REL = path.join(STATE_DIR, 'hme-autocommit.fail');
const COUNTER_REL = path.join(STATE_DIR, 'hme-autocommit.counter');
const LAST_SUCCESS_REL = path.join(STATE_DIR, 'hme-autocommit.last-success');

// Derive project root from THIS file's own path. Not from ctx, not from
// env, not from cwd. The original silent-failure bug was exactly the
// dependency on ctx.PROJECT_ROOT being defined — when it wasn't, the
// `if (!root) return;` line swallowed every failure mode silently.
// This module lives at tools/HME/proxy/middleware/proxy_autocommit.js,
// so the project root is four levels up.
const DERIVED_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function _ts() {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
}

// Write to four independent channels on any failure. Every channel is
// best-effort; we never throw from here because that would propagate
// into the proxy request handler.
function _recordFailure(root, caller, reason) {
  const ts = _ts();
  // Channel A: sticky fail flag under tmp/. Overwrite — latest wins.
  try {
    fs.mkdirSync(path.join(root, STATE_DIR), { recursive: true });
    fs.writeFileSync(path.join(root, FAIL_FLAG_REL),
      `[${ts}] [${caller}] ${reason}\n`);
  } catch (_) { /* best-effort */ }
  // Channel B: hme-errors.log for LIFESAVER text-scan pickup.
  try {
    fs.mkdirSync(path.join(root, 'log'), { recursive: true });
    fs.appendFileSync(path.join(root, ERR_LOG),
      `[${ts}] [autocommit:proxy] [${caller}] ${reason}\n`);
  } catch (_) { /* best-effort */ }
  // Channel C: stderr — ends up in hme-proxy.out.
  try {
    process.stderr.write(`[autocommit:proxy FAIL ${ts}] [${caller}] ${reason}\n`);
  } catch (_) { /* best-effort */ }
  // Channel D: activity bridge. Detached spawn so the request handler
  // isn't blocked by the Python startup cost.
  try {
    const emitPy = path.join(root, 'tools', 'HME', 'activity', 'emit.py');
    if (fs.existsSync(emitPy)) {
      const child = spawn('python3', [emitPy,
        '--event=coherence_violation',
        '--session=autocommit',
        '--verdict=FAIL',
        `--payload=${reason.slice(0, 400)}`,
      ], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, PROJECT_ROOT: root },
      });
      child.unref();
    }
  } catch (_) { /* best-effort */ }
}

function _recordSuccess(root) {
  try {
    fs.mkdirSync(path.join(root, STATE_DIR), { recursive: true });
    fs.writeFileSync(path.join(root, COUNTER_REL), '0');
    fs.writeFileSync(path.join(root, LAST_SUCCESS_REL), _ts());
    const flag = path.join(root, FAIL_FLAG_REL);
    if (fs.existsSync(flag)) fs.unlinkSync(flag);
  } catch (_) { /* best-effort */ }
}

function _incrementCounter(root) {
  try {
    fs.mkdirSync(path.join(root, STATE_DIR), { recursive: true });
    const cfile = path.join(root, COUNTER_REL);
    let n = 0;
    try {
      n = parseInt(fs.readFileSync(cfile, 'utf8').trim(), 10);
      if (!Number.isFinite(n)) n = 0;
    } catch (_) { n = 0; }
    fs.writeFileSync(cfile, String(n + 1));
  } catch (_) { /* best-effort */ }
}

function _attemptCommit(root, caller) {
  _incrementCounter(root);

  // Prereq validation. Even the derived root might be garbage (symlinks,
  // moved checkout). Validate before running git.
  if (!fs.existsSync(path.join(root, '.git'))) {
    _recordFailure(root, caller, `.git not found at ${root}`);
    return;
  }
  if (!fs.existsSync(path.join(root, 'src'))) {
    _recordFailure(root, caller, `src/ not found at ${root} — not a Polychron checkout`);
    return;
  }

  // git status porcelain also serves as "is git healthy" probe.
  let dirty = '';
  try {
    dirty = execSync('git status --porcelain',
      { cwd: root, encoding: 'utf8', timeout: 3000 });
  } catch (err) {
    _recordFailure(root, caller,
      `git status failed: ${String(err.message || err).slice(0, 300)}`);
    return;
  }
  if (!dirty.trim()) {
    // Clean tree — count as success so the counter doesn't climb.
    _recordSuccess(root);
    return;
  }

  try {
    execSync('git add -A', { cwd: root, timeout: 5000 });
  } catch (err) {
    _recordFailure(root, caller,
      `git add -A failed: ${String(err.message || err).slice(0, 300)}`);
    return;
  }

  // Use array form so the timestamp cannot shell-inject. Previous code
  // was `git commit -m "${ts}"` interpolated into a string passed to
  // execSync — not a vulnerability with ISO timestamps, but the array
  // form is the right pattern.
  const tstamp = new Date().toISOString().slice(0, 19);
  let r = spawnSync('git', ['commit', '-m', tstamp, '--quiet'],
    { cwd: root, timeout: 5000, encoding: 'utf8' });
  if (r.status === 0) { _recordSuccess(root); return; }
  let combined = (r.stderr || '') + (r.stdout || '');
  if (combined.includes('nothing to commit')) { _recordSuccess(root); return; }

  // Retry once — transient index-lock contention is the expected case.
  r = spawnSync('git', ['commit', '-m', `${tstamp}-retry`, '--quiet'],
    { cwd: root, timeout: 5000, encoding: 'utf8' });
  if (r.status === 0) { _recordSuccess(root); return; }
  combined = (r.stderr || '') + (r.stdout || '');
  if (combined.includes('nothing to commit')) { _recordSuccess(root); return; }

  _recordFailure(root, caller,
    `git commit failed twice: ${(combined || 'unknown').slice(0, 300)}`);
}

module.exports = {
  name: 'proxy_autocommit',

  onRequest({ payload, ctx }) {
    if (!payload || !Array.isArray(payload.messages)) return;
    // Prefer ctx.PROJECT_ROOT if present, fall back to the path-derived
    // root. Do NOT silently skip when ctx is missing — the old code did
    // exactly that and it was the root cause of the recurring silent
    // failure. If both ctx and derivation are bogus, the prereq checks
    // inside _attemptCommit record the failure to all four channels.
    const root = (ctx && ctx.PROJECT_ROOT) || DERIVED_ROOT;
    _attemptCommit(root, 'onRequest');
  },
};
