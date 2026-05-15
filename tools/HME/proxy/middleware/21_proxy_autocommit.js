'use strict';
// proxy_autocommit: request-driven autocommit middleware. Writes to the same
// state files as _autocommit.sh so AutocommitHealthVerifier sees both paths.

const fs = require('fs');
const path = require('path');
const { execSync, spawn, spawnSync } = require('child_process');

const ERR_LOG = 'log/hme-errors.log';
const STATE_DIR = path.join('runtime', 'hme');
const FAIL_FLAG_REL = path.join(STATE_DIR, 'autocommit.fail');
const COUNTER_REL = path.join(STATE_DIR, 'autocommit.counter');
const LAST_SUCCESS_REL = path.join(STATE_DIR, 'autocommit.last-success');
const HEARTBEAT_REL = path.join(STATE_DIR, 'heartbeat-autocommit.ts');
// Same lock file _autocommit.sh uses; serializes JS+bash autocommit callers.
const LOCK_REL = path.join(STATE_DIR, 'autocommit.lock');

// Project root derived from THIS file's path (not ctx/env/cwd) -- the
// silent-failure bug was ctx.PROJECT_ROOT being unset.
const DERIVED_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function _ts() {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
}

// Write to four independent channels on any failure. Every channel is
function _recordFailure(root, caller, reason) {
  const ts = _ts();
  // Channel A: sticky fail flag. Overwrite -- latest wins.
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
  // Channel C: stderr -- ends up in hme-proxy.out.
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
    fs.writeFileSync(path.join(root, HEARTBEAT_REL), String(Math.floor(Date.now() / 1000)));
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
    _recordFailure(root, caller, `src/ not found at ${root} -- not a Polychron checkout`);
    return;
  }

  // git status porcelain also serves as "is git healthy" probe.
  let dirty = '';
  try {
    dirty = execSync('git status --porcelain',
      { cwd: root, encoding: 'utf8', timeout: 3000 });
  } catch (err) {
    // silent-ok: optional fallback path.
    _recordFailure(root, caller,
      `git status failed: ${String(err.message || err).slice(0, 300)}`);
    return;
  }
  if (!dirty.trim()) {
    // Clean tree -- count as success so the counter doesn't climb.
    _recordSuccess(root);
    return;
  }

  // Acquire the same flock _autocommit.sh uses so JS + bash autocommit
  // serialize on a single lock; eliminates the recurring .git/index.lock race.
  const lockPath = path.join(root, LOCK_REL);
  try { fs.mkdirSync(path.dirname(lockPath), { recursive: true }); } catch (_) {}
  const tstamp = new Date().toISOString().slice(0, 19);
  // Forbid `git add -A` / `git add .` per AGENTS.md (sensitive-file leak risk).
  // Stage tracked-only via -u, then add untracked files matching safe extensions.
  const stageScript = [
    'git add -u',
    "git ls-files -o --exclude-standard -z " +
      "':(exclude)*.env' ':(exclude).env*' ':(exclude)*.pem' ':(exclude)*.key' " +
      "':(exclude)*.crt' ':(exclude)*credentials*' ':(exclude)*secret*' " +
      "':(exclude)*.bin' ':(exclude)*.so' ':(exclude)*.dll' ':(exclude)*.dylib' " +
      "| xargs -0 -r git add --",
  ].join(' && ');
  try {
    execSync(`flock -w 30 ${JSON.stringify(lockPath)} bash -c ${JSON.stringify(stageScript)}`,
      { cwd: root, timeout: 35000, shell: '/bin/bash' });
  } catch (err) {
    // silent-ok: optional fallback path.
    _recordFailure(root, caller,
      `git add (flocked) failed: ${String(err.message || err).slice(0, 300)}`);
    return;
  }
  let r = spawnSync('flock', ['-w', '30', lockPath,
    'git', 'commit', '-m', tstamp, '--quiet'],
    { cwd: root, timeout: 35000, encoding: 'utf8' });
  if (r.status === 0) { _recordSuccess(root); return; }
  let combined = (r.stderr || '') + (r.stdout || '');
  if (combined.includes('nothing to commit')) { _recordSuccess(root); return; }
  // Retry once -- transient lock-contention is expected on rapid fires.
  r = spawnSync('flock', ['-w', '30', lockPath,
    'git', 'commit', '-m', `${tstamp}-retry`, '--quiet'],
    { cwd: root, timeout: 35000, encoding: 'utf8' });
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
    // ctx.PROJECT_ROOT preferred; fallback to path-derived. Never silent-skip
    // (the old `if (!root) return` was the root-cause silent-fail bug).
    const root = (ctx && ctx.PROJECT_ROOT) || DERIVED_ROOT;
    _attemptCommit(root, 'onRequest');
  },
};
