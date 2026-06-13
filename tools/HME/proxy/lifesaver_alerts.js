'use strict';

const fs = require('fs');
const path = require('path');

const AUTOCOMMIT_FAIL_REL = path.join('tools', 'HME', 'runtime', 'autocommit.fail');
const LIFESAVER_HEARTBEAT_REL = path.join('tools', 'HME', 'runtime', 'heartbeat-lifesaver.ts');
const LIFESAVER_INJECT_LOG_REL = path.join('tools', 'HME', 'runtime', 'lifesaver-injections.jsonl');
const LIFESAVER_TEXT_RE = /\[ALERT\]\s+LIFESAVER|\bLIFESAVER\s+--/;
const CURRENT_AUTOCOMMIT_LABEL = 'CURRENT_AUTOCOMMIT_BLOCKER';
const HISTORICAL_AUTOCOMMIT_LABEL = 'HISTORICAL_AUTOCOMMIT_ALERT';

function _autocommitWindowMs(root) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'HME', 'config', 'runtime-freshness.json'), 'utf8'));
    const key = cfg && cfg.autocommit_error_freshness && cfg.autocommit_error_freshness.window_key;
    const sec = cfg && cfg.freshness_windows_sec && cfg.freshness_windows_sec[key || 'autocommit_error_current'];
    if (Number.isFinite(sec) && sec > 0) return sec * 1000;
  } catch (_e) { /* default below */ }
  return 30 * 60 * 1000;
}

function _bodyTimestampMs(body) {
  const m = /^\s*\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\]/.exec(String(body || ''));
  if (!m) return 0;
  const t = Date.parse(m[1]);
  return Number.isFinite(t) ? t : 0;
}

function _autocommitFreshness(root, flagPath, body) {
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(flagPath).mtimeMs; } catch (_e) { /* unreadable is handled by caller */ }
  const tsMs = _bodyTimestampMs(body) || mtimeMs;
  const ageMs = tsMs ? Math.max(0, Date.now() - tsMs) : Infinity;
  const windowMs = _autocommitWindowMs(root);
  const current = ageMs <= windowMs;
  return {
    label: current ? CURRENT_AUTOCOMMIT_LABEL : HISTORICAL_AUTOCOMMIT_LABEL,
    current,
    timestamp: tsMs ? new Date(tsMs).toISOString() : '',
    age_sec: Number.isFinite(ageMs) ? Math.floor(ageMs / 1000) : null,
    window_sec: Math.floor(windowMs / 1000),
  };
}

function readAutocommitFailure(root) {
  const flagPath = path.join(root, AUTOCOMMIT_FAIL_REL);
  let body = '';
  try {
    body = fs.readFileSync(flagPath, 'utf8').trim();
  // silent-ok: missing autocommit.fail = no alert; unreadable becomes banner.
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    body = `Autocommit fail flag exists but is unreadable: ${err.message}`;
  }
  const freshness = _autocommitFreshness(root, flagPath, body);
  const header = freshness.current
    ? '[ALERT] LIFESAVER - AUTOCOMMIT FAILED - FIX BEFORE ANYTHING ELSE'
    : 'LIFESAVER historical autocommit failure (not a current blocker)';
  const guidance = freshness.current
    ? `The autocommit helper left this flag behind. Last attempt did not
succeed, which means working-tree changes have NOT been committed.
Diagnose: check git status in the project root; read log/hme-errors.log;
inspect tools/HME/runtime/autocommit.err if present; verify .env loaded PROJECT_ROOT.
Fix the root cause. Do not silence the alert -- the flag clears automatically
on the next successful autocommit.`
    : `Historical autocommit failure record only. Do not stop on this line unless current git status/precommit still fail; a newer successful autocommit supersedes it.`;
  const banner = `${header}
[${freshness.label}] timestamp=${freshness.timestamp || 'unknown'} age_sec=${freshness.age_sec == null ? 'unknown' : freshness.age_sec} window_sec=${freshness.window_sec}

${body}

${guidance}`;
  return { flagPath, body, banner, freshness };
}


function recordLifesaverInjection(root, source, banner, meta = {}) {
  try {
    const logPath = path.join(root, LIFESAVER_INJECT_LOG_REL);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify({
      ts: new Date().toISOString(),
      source: source || 'unknown',
      bytes: Buffer.byteLength(String(banner || '')),
      ...meta,
    }) + '\n');
    return true;
  // silent-ok: ledger write is dedupe-only; alert already reached model.
  } catch (_e) {
    return false;
  }
}

function assertRealLifesaverInjection(root, source, banner, meta = {}) {
  const text = String(banner || '');
  if (!LIFESAVER_TEXT_RE.test(text)) return false;
  touchLifesaverHeartbeat(root);
  return recordLifesaverInjection(root, source, text, meta);
}

function touchLifesaverHeartbeat(root) {
  try {
    const heartbeat = path.join(root, LIFESAVER_HEARTBEAT_REL);
    fs.mkdirSync(path.dirname(heartbeat), { recursive: true });
    fs.writeFileSync(heartbeat, String(Math.floor(Date.now() / 1000)));
    return true;
  // silent-ok: heartbeat is advisory; ledger decides injection success.
  } catch (_e) {
    return false;
  }
}

module.exports = {
  AUTOCOMMIT_FAIL_REL,
  LIFESAVER_HEARTBEAT_REL,
  LIFESAVER_INJECT_LOG_REL,
  CURRENT_AUTOCOMMIT_LABEL,
  HISTORICAL_AUTOCOMMIT_LABEL,
  readAutocommitFailure,
  touchLifesaverHeartbeat,
  recordLifesaverInjection,
  assertRealLifesaverInjection,
};
