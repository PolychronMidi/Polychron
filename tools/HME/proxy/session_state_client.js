'use strict';
const http = require('http');
const sessionState = require('./session_state');
const { servicePort } = require('./service_registry');

function _http(method, path, body) {
  const port = servicePort('worker');
  const payload = body ? JSON.stringify(body) : '';
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, timeout: 250, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
        catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('session-state http timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

async function call(action, sessionId = '', payload = {}) {
  if (process.env.HME_SESSION_IPC !== 'http') {
    try {
      if (action === 'read') return sessionState.readState(sessionId);
      if (action === 'record-read') return sessionState.recordRead(payload.payload || {}, { ...payload.meta, session_id: sessionId });
      if (action === 'phase') return sessionState.recordPhase(payload.phase, { ...payload.meta, session_id: sessionId });
      if (action === 'write') return sessionState.recordWrite(payload.payload || {}, payload.decision || {});
      if (action === 'verification-evidence') return sessionState.recordVerificationEvidence({ ...payload, session_id: sessionId });
      if (action === 'detector-outcome') return sessionState.recordDetectorOutcome(payload.name, payload.verdict, { ...payload.meta, session_id: sessionId });
    } catch (_e) { /* fall through */ }
  }
  try {
    const sid = encodeURIComponent(sessionId || '_');
    if (action === 'read') return await _http('GET', `/hme/session/${sid}/state`);
    if (action === 'record-read') return await _http('POST', `/hme/session/${sid}/read`, payload);
    return await _http('POST', `/hme/session/${sid}/${action}`, payload);
  } catch (_e) {
    // silent-ok: optional fallback path.
    if (action === 'read') return sessionState.readState(sessionId);
    if (action === 'record-read') return sessionState.recordRead(payload.payload || {}, { ...payload.meta, session_id: sessionId });
    if (action === 'phase') return sessionState.recordPhase(payload.phase, { ...payload.meta, session_id: sessionId });
    if (action === 'write') return sessionState.recordWrite(payload.payload || {}, payload.decision || {});
    if (action === 'verification-evidence') return sessionState.recordVerificationEvidence({ ...payload, session_id: sessionId });
    if (action === 'detector-outcome') return sessionState.recordDetectorOutcome(payload.name, payload.verdict, { ...payload.meta, session_id: sessionId });
    return sessionState.readState(sessionId);
  }
}

module.exports = { call };
