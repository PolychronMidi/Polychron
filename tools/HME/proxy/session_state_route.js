'use strict';
const sessionState = require('./session_state');

function _body(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8') || '{}'));
    req.on('error', () => resolve('{}'));
  });
}

function _json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function handleSessionStateRoute(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const parts = url.pathname.split('/').filter(Boolean);
  const sid = decodeURIComponent(parts[2] || '');
  const action = parts[3] || '';
  if (parts[0] !== 'hme' || parts[1] !== 'session') return _json(res, 404, { error: 'not_found' });
  if (req.method === 'GET' && action === 'state') return _json(res, 200, sessionState.readState(sid));
  if (req.method !== 'POST') return _json(res, 405, { error: 'POST only' });
  let data = {};
  try { data = JSON.parse(await _body(req)); } catch (_e) { data = {}; }
  if (action === 'phase') return _json(res, 200, sessionState.recordPhase(data.phase, { ...data.meta, session_id: sid }));
  if (action === 'write') return _json(res, 200, sessionState.recordWrite(data.payload || {}, data.decision || {}));
  if (action === 'read') return _json(res, 200, sessionState.recordRead(data.payload || {}, { ...data.meta, session_id: sid }));
  if (action === 'verification-evidence') return _json(res, 200, sessionState.recordVerificationEvidence({ ...data, session_id: sid }));
  if (action === 'detector-outcome') return _json(res, 200, sessionState.recordDetectorOutcome(data.name, data.verdict, { ...data.meta, session_id: sid }));
  return _json(res, 404, { error: 'unknown_session_action' });
}

module.exports = { handleSessionStateRoute };
