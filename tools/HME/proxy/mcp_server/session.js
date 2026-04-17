'use strict';
// Session state: session_id → SSE response stream. Claude Code opens an SSE
// connection, we assign a session_id, and all subsequent POSTs to
// /mcp/messages?session_id=<id> push their JSON-RPC responses back through
// that SSE stream.

const crypto = require('crypto');
const { sseEvent } = require('./protocol');

// id → { res, createdAt, lastEvent, initialized }
const _sessions = new Map();
const SESSION_TTL_MS = 10 * 60 * 1000; // reap streams that haven't seen traffic in 10 min

function createSession(res) {
  const id = crypto.randomUUID();
  _sessions.set(id, { res, createdAt: Date.now(), lastEvent: Date.now(), initialized: false });
  res.on('close', () => { _sessions.delete(id); });
  res.on('error', () => { _sessions.delete(id); });
  return id;
}

function get(id) {
  return _sessions.get(id) || null;
}

function markInitialized(id) {
  const s = _sessions.get(id);
  if (s) s.initialized = true;
}

// Reaper: drop sessions whose SSE stream has been silent too long. Runs every
// 2 minutes. Prevents orphan sessions from a crashed client tying up memory.
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of _sessions) {
    if (now - s.lastEvent > SESSION_TTL_MS) {
      try { s.res.end(); } catch (_e) { /* ignore */ }
      _sessions.delete(id);
    }
  }
}, 120_000).unref();

function send(id, jsonrpcMessage) {
  const s = _sessions.get(id);
  if (!s) return false;
  try {
    s.res.write(sseEvent('message', jsonrpcMessage));
    s.lastEvent = Date.now();
    return true;
  } catch (_err) {
    _sessions.delete(id);
    return false;
  }
}

function close(id) {
  const s = _sessions.get(id);
  if (s) {
    try { s.res.end(); } catch (_e) { /* ignore */ }
    _sessions.delete(id);
  }
}

function stats() {
  return { active: _sessions.size };
}

module.exports = { createSession, get, markInitialized, send, close, stats };
