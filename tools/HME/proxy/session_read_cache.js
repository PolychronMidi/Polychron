'use strict';
// Per-session cache of files the model has Read this session. Used by the
// Edit->Read SSE fallback so we can detect "Edit before Read" client-side
// errors and rewrite to Read proactively.

const fs = require('fs');
const path = require('path');
const hmePaths = require('./hme_paths');

const CACHE_DIR = process.env.HME_SESSION_READ_CACHE_DIR || path.join(hmePaths.HME_RUNTIME_DIR, 'session-read-cache');
const TTL_MS = 6 * 60 * 60 * 1000; // 6h; sessions rarely outlive this

function _cachePath(sessionId) {
  const safe = String(sessionId || 'unknown').replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 80);
  return path.join(CACHE_DIR, `${safe}.json`);
}

function _load(sessionId) {
  try {
    const raw = fs.readFileSync(_cachePath(sessionId), 'utf8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && obj.files && typeof obj.files === 'object') return obj;
  } catch (_e) { /* silent-ok: missing or corrupt cache resets to empty */ }
  return { files: {} };
}

function _save(sessionId, obj) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(_cachePath(sessionId), JSON.stringify(obj));
  } catch (_e) { /* silent-ok: cache write best-effort */ }
}

function recordRead(sessionId, filePath, meta = {}) {
  if (!sessionId || !filePath) return;
  const obj = _load(sessionId);
  obj.files[String(filePath)] = { ts: Date.now(), v: 2, source: meta.source || 'read' };
  _save(sessionId, obj);
}

function hasRead(sessionId, filePath) {
  if (!sessionId || !filePath) return false;
  const obj = _load(sessionId);
  const rec = obj.files[String(filePath)];
  if (!rec || typeof rec !== 'object') return false;
  if (rec.v !== 2) return false;
  const ts = Number(rec.ts);
  if (!Number.isFinite(ts)) return false;
  return (Date.now() - ts) < TTL_MS;
}

function clearSession(sessionId) {
  try { fs.unlinkSync(_cachePath(sessionId)); } catch (_e) { /* silent-ok: idempotent clear */ }
}

module.exports = { recordRead, hasRead, clearSession, CACHE_DIR };
