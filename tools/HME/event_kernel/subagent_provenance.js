'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TOKEN_RE = /^[a-f0-9]{48}$/;
const MAX_AGE_MS = 10 * 60 * 1000;

function _dir(root) {
  return path.join(root, 'tools', 'HME', 'runtime', 'subagent-stop-tokens');
}

function _file(root, token) {
  if (!TOKEN_RE.test(String(token || ''))) return '';
  return path.join(_dir(root), `${token}.json`);
}

function _safeField(value) {
  return String(value || '').slice(0, 512);
}

function issueSubagentToken(root, payload = {}) {
  const token = crypto.randomBytes(24).toString('hex');
  const dir = _dir(root);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const body = JSON.stringify({
    token,
    session_id: _safeField(payload.session_id),
    transcript_path: _safeField(payload.transcript_path),
    host: _safeField(payload._hme_host),
    issued_at: Date.now(),
  }) + '\n';
  const tmp = path.join(dir, `.${token}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, body, { mode: 0o600 });
  fs.renameSync(tmp, _file(root, token));
  return token;
}

function verifySubagentToken(root, payload = {}, opts = {}) {
  const token = payload && payload._hme_subagent_token;
  const file = _file(root, token);
  if (!file) return false;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_err) { return false; }
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  const maxAgeMs = typeof opts.maxAgeMs === 'number' ? opts.maxAgeMs : MAX_AGE_MS;
  const ok = parsed && parsed.token === token
    && typeof parsed.issued_at === 'number'
    && now - parsed.issued_at >= 0
    && now - parsed.issued_at <= maxAgeMs
    && (!parsed.session_id || parsed.session_id === _safeField(payload.session_id))
    && (!parsed.transcript_path || parsed.transcript_path === _safeField(payload.transcript_path))
    && (!parsed.host || parsed.host === _safeField(payload._hme_host));
  if (opts.consume !== false) {
    try { fs.unlinkSync(file); }
    catch (_err) { /* silent-ok: token consumption is best-effort after validation. */ }
  }
  return Boolean(ok);
}

module.exports = { issueSubagentToken, verifySubagentToken, MAX_AGE_MS };
