'use strict';

// Per-session conversation accumulator for protocols whose upstream is stateful
// by design but whose actual routed backend is stateless (e.g. Codex /v1/responses

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('../shared');

const SESSIONS_DIR = path.join(PROJECT_ROOT, 'tools', 'HME', 'runtime', 'codex-sessions');
const MAX_ITEMS_PER_SESSION = 2000;
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

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
  let written = 0;
  try {
    const ts = Date.now();
    const lines = items
      .filter((it) => it && typeof it === 'object')
      .map((it) => JSON.stringify({ ts, item: it }))
      .join('\n') + '\n';
    fs.appendFileSync(f, lines);
    written = items.length;
  } catch (_) { /* best-effort; conversation continuity degrades gracefully */ }
  return written;
}

function loadHistory(sessionId, maxAgeMs = STALE_AFTER_MS, cap = MAX_ITEMS_PER_SESSION) {
  if (!sessionId) return [];
  const f = _sessionFile(sessionId);
  if (!fs.existsSync(f)) return [];
  const now = Date.now();
  const out = [];
  try {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    for (const ln of lines) {
      if (!ln) continue;
      let rec;
      try { rec = JSON.parse(ln); } catch (_) { continue; }
      if (!rec || typeof rec !== 'object' || !rec.item) continue;
      if (typeof rec.ts === 'number' && (now - rec.ts) > maxAgeMs) continue;
      out.push(rec.item);
    }
  } catch (_) { /* best-effort; treat as empty history */ }
  return out.length > cap ? out.slice(-cap) : out;
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
