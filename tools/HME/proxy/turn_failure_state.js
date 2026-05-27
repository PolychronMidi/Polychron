'use strict';

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./shared');

const STATE_FILE = 'hme-last-tool-failure.json';
const TTL_MS = 10 * 60 * 1000;

function statePath(root = PROJECT_ROOT) { return path.join(root, 'tmp', STATE_FILE); }

function clearFailure(root = PROJECT_ROOT) {
  try { fs.rmSync(statePath(root), { force: true }); } catch (_err) { /* advisory */ }
}

function recordFailure(root = PROJECT_ROOT, row = {}) {
  const data = { ts: new Date().toISOString(), ...row };
  fs.mkdirSync(path.dirname(statePath(root)), { recursive: true });
  fs.writeFileSync(statePath(root), JSON.stringify(data));
  return data;
}

function readFailure(root = PROJECT_ROOT) {
  try {
    const data = JSON.parse(fs.readFileSync(statePath(root), 'utf8'));
    const age = Date.now() - Date.parse(data.ts || '');
    if (!Number.isFinite(age) || age > TTL_MS) { clearFailure(root); return null; }
    return data;
  } catch (_err) {
    return null;
  }
}

function isNoopCommand(cmd) {
  const s = String(cmd || '').trim();
  if (!s) return true;
  return s === ':' || s === 'true' || s === 'builtin true' || s === 'command true'
    || /^echo\s*(['"]{0,2})\s*\1$/.test(s)
    || /^printf\s+(['"]{2}|%s\\n\s+['"]{2})$/.test(s);
}

function noopAfterFailureDecision(cmd, root = PROJECT_ROOT) {
  if (!isNoopCommand(cmd)) return null;
  const failure = readFailure(root);
  if (!failure) return null;
  return {
    decision: 'deny',
    reason: `BLOCKED: no-op command after failed ${failure.tool || 'tool'} (${failure.reason || 'unknown failure'}). Stop and re-plan; do not appease gates with empty success.`,
    code: 'noop_after_failure',
  };
}

module.exports = { statePath, recordFailure, readFailure, clearFailure, isNoopCommand, noopAfterFailureDecision };
