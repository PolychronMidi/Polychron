'use strict';
// Session state: session_id → SSE response stream. Claude Code opens an SSE
// connection, we assign a session_id, and all subsequent POSTs to
// /mcp/messages?session_id=<id> push their JSON-RPC responses back through
// that SSE stream.

const crypto = require('crypto');
const { sseEvent } = require('./protocol');

const _sessions = new Map(); // id → { res, createdAt, lastEvent }

function createSession(res) {
  const id = crypto.randomUUID();
  _sessions.set(id, { res, createdAt: Date.now(), lastEvent: Date.now() });
  res.on('close', () => { _sessions.delete(id); });
  res.on('error', () => { _sessions.delete(id); });
  return id;
}

function get(id) {
  return _sessions.get(id) || null;
}

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

module.exports = { createSession, get, send, close, stats };
