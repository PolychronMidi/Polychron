'use strict';
// proxy_autocommit: request-driven autocommit middleware. Writes to the same
// state files as _autocommit.sh so AutocommitHealthVerifier sees both paths.

const fs = require('fs');
const path = require('path');
const { execSync, spawn, spawnSync } = require('child_process');

const ERR_LOG = 'log/hme-errors.log';
const STATE_DIR = path.join('tools', 'HME', 'runtime');
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
    try {
      const helper = path.join(root, 'tools', 'HME', 'hooks', 'helpers', 'lifesaver_crying_wolf.py');
      if (fs.existsSync(helper)) spawnSync('python3', [helper, '--project-root', root, '--mode', 'autocommit-success', '--reason', 'proxy-autocommit-success', '--quiet'], { cwd: root, timeout: 3000, encoding: 'utf8' });
    } catch (_) { /* best-effort */ }
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

// Sweep stale .git/index.lock. Git removes its own lock on clean exit, but
// SIGKILL'd children (timeouts, OOM, ENOSPC mid-write) leave it behind. The
// agent should never have to `rm .git/index.lock` by hand -- this is that
// maintenance, automated. Only removes when (a) no live git process owns
// the lock (lsof unavailable, so we use age) and (b) the lock is older than
// a generous threshold so we don't fight an active git invocation.
function _sweepStaleIndexLock(root) {
  const lock = path.join(root, '.git', 'index.lock');
  let st;
  try { st = fs.statSync(lock); } catch (_) { return false; }
  const ageMs = Date.now() - st.mtimeMs;
  // 20s is well past any realistic interactive git op; flock/git timeouts
  // here are <=35s but the lock is held only across atomic index writes.
  if (ageMs < 20000) return false;
  try {
    fs.unlinkSync(lock);
    fs.appendFileSync(path.join(root, ERR_LOG),
      `[${_ts()}] [autocommit:proxy] swept stale .git/index.lock (age=${Math.round(ageMs)}ms)\n`);
    return true;
  } catch (_) { return false; }
}

// Capture precommit_validate.py output directly so failures surface with
// file:line and reason in autocommit.fail + hme-errors.log. Without this,
// `git commit` failures showed up as 'git commit failed twice: unknown'.
function _capturePrecommitFailures(root) {
  const script = path.join(root, 'tools', 'HME', 'scripts', 'precommit_validate.py');
  if (!fs.existsSync(script)) return '';
  try {
    const r = spawnSync('python3', [script],
      { cwd: root, timeout: 10000, encoding: 'utf8',
        env: { ...process.env, PROJECT_ROOT: root } });
    if (r.status === 0) return '';
    const out = ((r.stdout || '') + (r.stderr || '')).trim();
    return out.slice(0, 1500);
  } catch (_) { return ''; }
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

  // Self-heal: clear stale .git/index.lock left by interrupted children.
  _sweepStaleIndexLock(root);

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

  // Hold one flock across stage AND commit so a concurrent autocommit caller
  // (proxy onRequest, _autocommit.sh from stop hook, or autocommit-direct.sh)
  // can't sneak `git add` in while another's `git commit` holds .git/index.lock.
  // Earlier design released flock between stage and commit, opening that race.
  const lockPath = path.join(root, LOCK_REL);
  try { fs.mkdirSync(path.dirname(lockPath), { recursive: true }); } catch (_) {}
  const tstamp = new Date().toISOString().slice(0, 19);
  // Forbid broad git add forms per AGENTS.md.
  // Stage tracked-only via -u, then add untracked files matching safe extensions.
  // Commit inside the same flock; retry once for transient lock contention.
  // Gate commit on `git diff --cached --quiet` because `git commit --quiet`
  // exits 1 with NO stderr/stdout when index is empty -- previously surfaced
  // as the cryptic "git commit failed twice: no git stderr" failure spam.
  const stageAndCommitScript = [
    'set -e',
    'git add -u',
    "git ls-files -o --exclude-standard -z " +
      "':(exclude)*.env' ':(exclude).env*' ':(exclude)*.pem' ':(exclude)*.key' " +
      "':(exclude)*.crt' ':(exclude)*credentials*' ':(exclude)*secret*' " +
      "':(exclude)*.bin' ':(exclude)*.so' ':(exclude)*.dll' ':(exclude)*.dylib' " +
      "| xargs -0 -r git add --",
    `if ! git diff --cached --quiet; then ` +
      `git commit -m ${JSON.stringify(tstamp)} --quiet || ` +
      `git commit -m ${JSON.stringify(tstamp + '-retry')} --quiet; ` +
    `fi`,
  ].join(' && ');
  let r = spawnSync('flock', ['-w', '30', lockPath,
    'bash', '-c', stageAndCommitScript],
    { cwd: root, timeout: 60000, encoding: 'utf8' });
  if (r.status === 0) { _recordSuccess(root); return; }
  let combined = (r.stderr || '') + (r.stdout || '');
  if (combined.includes('nothing to commit')) { _recordSuccess(root); return; }
  // When the pre-commit hook rejects, git often funnels its stderr away from
  // spawn's pipe (the hook runs in its own process group). Re-run
  // precommit_validate.py directly so the actual blocker (file:line + reason)
  // lands in autocommit.fail + hme-errors.log instead of 'unknown'.
  const precommitDetail = _capturePrecommitFailures(root);
  const head = (combined || '').trim().slice(0, 300) || 'no git stderr';
  const tail = precommitDetail ? ` | precommit: ${precommitDetail}` : '';
  _recordFailure(root, caller, `git commit failed twice: ${head}${tail}`);
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
