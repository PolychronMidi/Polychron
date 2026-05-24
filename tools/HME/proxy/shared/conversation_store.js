'use strict';

// Per-session conversation accumulator for protocols whose upstream is stateful
// by design but whose actual routed backend is stateless (e.g. Codex /v1/responses

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PROJECT_ROOT } = require('../shared');

const SESSIONS_DIR = path.join(PROJECT_ROOT, 'tools', 'HME', 'runtime', 'codex-sessions');

function _itemHash(item) {
  try { return crypto.createHash('sha1').update(JSON.stringify(item)).digest('hex').slice(0, 16); }
  catch (_) { return ''; }
}

// In-memory hash cache per session: avoids re-hashing entire stored history
// on every appendItems call. Hydrates from disk on first access per session.
const _hashCache = new Map();
function _ensureHashCache(sessionId) {
  if (_hashCache.has(sessionId)) return _hashCache.get(sessionId);
  const set = new Set();
  for (const it of loadHistory(sessionId)) {
    const h = _itemHash(it);
    if (h) set.add(h);
  }
  _hashCache.set(sessionId, set);
  return set;
}

function _safeSessionId(sessionId) {
  return String(sessionId || '').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 128) || 'unknown';
}

function _sessionFile(sessionId) {
  return path.join(SESSIONS_DIR, `${_safeSessionId(sessionId)}.jsonl`);
}

function _ensureDir() {
  try { fs.mkdirSync(SESSIONS_DIR, { recursive: true }); } catch (_) { /* dir exists */ }
}

function appendItems(sessionId, items) {
  if (!sessionId || !Array.isArray(items) || items.length === 0) return 0;
  _ensureDir();
  const f = _sessionFile(sessionId);
  const seen = _ensureHashCache(sessionId);
  const fresh = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const h = _itemHash(it);
    if (!h || seen.has(h)) continue;
    seen.add(h);
    fresh.push(it);
  }
  if (fresh.length === 0) return 0;
  try {
    const ts = Date.now();
    const lines = fresh.map((it) => JSON.stringify({ ts, item: it })).join('\n') + '\n';
    fs.appendFileSync(f, lines);
  } catch (_) { /* best-effort; conversation continuity degrades gracefully */ }
  return fresh.length;
}

function loadHistory(sessionId) {
  if (!sessionId) return [];
  const f = _sessionFile(sessionId);
  if (!fs.existsSync(f)) return [];
  const out = [];
  try {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    for (const ln of lines) {
      if (!ln) continue;
      let rec;
      try { rec = JSON.parse(ln); } catch (_) { continue; }
      if (!rec || typeof rec !== 'object' || !rec.item) continue;
      out.push(rec.item);
    }
  } catch (_) { /* best-effort; treat as empty history */ }
  return out;
}

function compactSession(sessionId) {
  if (!sessionId) return;
  const f = _sessionFile(sessionId);
  if (!fs.existsSync(f)) return;
  const live = loadHistory(sessionId);
  const tmp = f + '.compact.tmp';
  try {
    const ts = Date.now();
    const lines = live.map((it) => JSON.stringify({ ts, item: it })).join('\n');
    fs.writeFileSync(tmp, lines ? lines + '\n' : '');
    fs.renameSync(tmp, f);
  } catch (_) { try { fs.unlinkSync(tmp); } catch (_) { /* tmp already gone */ } }
}

function clearSession(sessionId) {
  if (!sessionId) return;
  try { fs.unlinkSync(_sessionFile(sessionId)); } catch (_) { /* already gone */ }
}

function listSessions() {
  try { return fs.readdirSync(SESSIONS_DIR).filter((n) => n.endsWith('.jsonl')).map((n) => n.replace(/\.jsonl$/, '')); }
  catch (_) { return []; }
}

module.exports = {
  appendItems,
  loadHistory,
  compactSession,
  clearSession,
  listSessions,
  paths: { SESSIONS_DIR },
};
