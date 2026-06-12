'use strict';
// proxy_autocommit: request path enqueues autocommit intent; the shell helper
// owns the single writer that drains the queue and touches git/autocommit state.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ERR_LOG = 'log/hme-errors.log';
const STATE_DIR = path.join('tools', 'HME', 'runtime');
const FAIL_FLAG_REL = path.join(STATE_DIR, 'autocommit.fail');
const LAST_ATTEMPT_REL = path.join(STATE_DIR, 'autocommit.last-attempt');
const HELPER_REL = path.join('tools', 'HME', 'hooks', 'helpers', '_autocommit.sh');

// Project root derived from THIS file's path (not ctx/env/cwd) -- the
// silent-failure bug was ctx.PROJECT_ROOT being unset.
const DERIVED_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

// Kept as a contract helper: prior lock races are no longer surfaced by this
// middleware because the request path no longer runs git, but tests pin the
const _BENIGN_RACE_RE = /index\.lock|Another git process seems to be running|nothing to commit/i;
function _isBenignRace(combined) {
  return _BENIGN_RACE_RE.test(String(combined || ''));
}

function _ts() {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
}

function _debounceAutocommit(root) {
  const debounceMs = Number(process.env.HME_AUTOCOMMIT_DEBOUNCE_MS || '5000');
  if (!Number.isFinite(debounceMs) || debounceMs <= 0) return false;
  const now = Date.now();
  const p = path.join(root, LAST_ATTEMPT_REL);
  try {
    const prior = Number(fs.readFileSync(p, 'utf8').trim());
    if (Number.isFinite(prior) && (now - prior) < debounceMs) return true;
  } catch (_) { /* no prior attempt */ }
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, String(now));
  } catch (_) { /* best-effort */ }
  return false;
}

function _recordHelperFailure(root, caller, reason) {
  const body = `[${caller}] ${reason}`;
  const ts = _ts();
  try {
    fs.mkdirSync(path.join(root, STATE_DIR), { recursive: true });
    const flag = path.join(root, FAIL_FLAG_REL);
    try {
      if (fs.readFileSync(flag, 'utf8').includes(body)) return;
    } catch (_) { /* no prior flag */ }
    fs.writeFileSync(flag, `[${ts}] ${body}\n`);
  } catch (_) { /* best-effort */ }
  try {
    fs.mkdirSync(path.join(root, 'log'), { recursive: true });
    fs.appendFileSync(path.join(root, ERR_LOG), `[${ts}] [autocommit:proxy] ${body}\n`);
  } catch (_) { /* best-effort */ }
  try { process.stderr.write(`[autocommit:proxy FAIL ${ts}] ${body}\n`); } catch (_) { /* best-effort */ }
}

function _enqueueViaHelper(root, caller) {
  const helper = path.join(root, HELPER_REL);
  if (!fs.existsSync(helper)) {
    _recordHelperFailure(root, caller, `helper missing at ${helper}`);
    return;
  }
  const script = 'source "$1"; _ac_enqueue_commit "$HME_AUTOCOMMIT_CALLER"';
  try {
    const child = spawn('bash', ['-c', script, '_', helper], {
      cwd: root,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, PROJECT_ROOT: root, HME_AUTOCOMMIT_CALLER: caller },
    });
    child.on('error', (err) => {
      _recordHelperFailure(root, caller, `autocommit queue helper spawn failed: ${String(err.message || err).slice(0, 600)}`);
    });
    child.unref();
  // silent-ok: failure IS surfaced -- _recordHelperFailure writes fail-flag + hme-errors
  } catch (err) {
    _recordHelperFailure(root, caller, `autocommit queue helper spawn failed: ${String(err.message || err).slice(0, 600)}`);
  }
}

module.exports = {
  name: 'proxy_autocommit',
  _isBenignRace,

  onRequest({ payload, ctx }) {
    if (!payload || !Array.isArray(payload.messages)) return;
    const root = (ctx && ctx.PROJECT_ROOT) || DERIVED_ROOT;
    if (_debounceAutocommit(root)) return;
    _enqueueViaHelper(root, 'onRequest');
  },
};
