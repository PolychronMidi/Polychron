#!/usr/bin/env node
'use strict';

// HME proxy shuffler. Listens on HME_PROXY_PORT (9099) and forwards every
// inbound request to whichever backend (proxy_a:9100, proxy_b:9101) is

const fs = require('fs');
const path = require('path');
const http = require('http');
const { loadEnv, requireEnv } = require('../shared/load_env');

loadEnv(path.resolve(__dirname, '..', '..', '..', '..', '.env'));

const PROJECT_ROOT = requireEnv('PROJECT_ROOT');
const SHUFFLER_PORT = Number(requireEnv('HME_PROXY_PORT'));
const BACKEND_A_PORT = Number(requireEnv('HME_PROXY_BACKEND_A_PORT'));
const BACKEND_B_PORT = Number(requireEnv('HME_PROXY_BACKEND_B_PORT'));
const HEARTBEAT_STALE_MS = Number(requireEnv('HME_PROXY_HEARTBEAT_STALE_MS'));
const HEALTH_POLL_MS = 250;
const STICKY_REPLAY_TAIL = 500;
const STICKY_MAP_CAP = 10_000;

const RUNTIME_DIR = path.join(PROJECT_ROOT, 'tools', 'HME', 'runtime');
const HEALTH_FILES = {
  a: path.join(RUNTIME_DIR, 'proxy-a.health'),
  b: path.join(RUNTIME_DIR, 'proxy-b.health'),
};
const STICKY_LOG = path.join(RUNTIME_DIR, 'sticky-sessions.jsonl');
const SHUFFLER_PID_FILE = path.join(RUNTIME_DIR, 'shuffler.pid');

const BACKENDS = {
  a: { port: BACKEND_A_PORT, health: null },
  b: { port: BACKEND_B_PORT, health: null },
};

const stickyMap = new Map(); // session_id -> slot

function _readJSONSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}

function _refreshHealth() {
  const now = Date.now();
  for (const slot of Object.keys(BACKENDS)) {
    const h = _readJSONSafe(HEALTH_FILES[slot]);
    if (!h || typeof h !== 'object') { BACKENDS[slot].health = null; continue; }
    const fresh = (now - Number(h.ts || 0)) <= HEARTBEAT_STALE_MS;
    BACKENDS[slot].health = fresh ? h : null;
  }
}

function _isRoutable(slot) {
  const h = BACKENDS[slot].health;
  return !!(h && h.ready && !h.draining);
}

function _routableSlots() {
  return Object.keys(BACKENDS).filter(_isRoutable);
}

function _pickSlot(sessionId) {
  const routable = _routableSlots();
  if (routable.length === 0) return null;
  if (sessionId && stickyMap.has(sessionId)) {
    const prior = stickyMap.get(sessionId);
    if (routable.includes(prior)) return prior;
    // Prior slot now unroutable -> rebind to a healthy one and log.
    const next = routable[0];
    _setSticky(sessionId, next);
    _appendSticky(sessionId, next);
    return next;
  }
  // No prior assignment: pick least-loaded by reported in_flight.
  let best = routable[0];
  let bestLoad = Number(BACKENDS[best].health.in_flight || 0);
  for (const s of routable.slice(1)) {
    const load = Number(BACKENDS[s].health.in_flight || 0);
    if (load < bestLoad) { best = s; bestLoad = load; }
  }
  if (sessionId) {
    _setSticky(sessionId, best);
    _appendSticky(sessionId, best);
  }
  return best;
}

function _setSticky(sessionId, slot) {
  // LRU-touch: delete + re-insert moves key to insertion-order tail.
  if (stickyMap.has(sessionId)) stickyMap.delete(sessionId);
  stickyMap.set(sessionId, slot);
  if (stickyMap.size > STICKY_MAP_CAP) {
    const oldest = stickyMap.keys().next().value;
    stickyMap.delete(oldest);
  }
}

function _appendSticky(sessionId, slot) {
  try {
    fs.appendFileSync(STICKY_LOG, JSON.stringify({ session_id: sessionId, slot, ts: Date.now() }) + '\n');
  } catch (_) { /* best-effort; routing still works in-memory */ }
}

function _replayStickyMemory() {
  if (!fs.existsSync(STICKY_LOG)) return;
  try {
    const lines = fs.readFileSync(STICKY_LOG, 'utf8').trim().split('\n').slice(-STICKY_REPLAY_TAIL);
    for (const line of lines) {
      try {
        const rec = JSON.parse(line);
        if (rec.session_id && rec.slot) _setSticky(rec.session_id, rec.slot);
      } catch (_) { /* skip malformed entry */ }
    }
  } catch (_) { /* sticky log missing/unreadable; in-memory map starts empty */ }
}

function _extractSessionId(reqHeaders, bodyBuf) {
  const headerSid = reqHeaders['x-session-id'] || reqHeaders['x-hme-session-id'];
  if (headerSid) return String(headerSid);
  if (!bodyBuf || !bodyBuf.length) return null;
  try {
    const data = JSON.parse(bodyBuf.toString('utf8'));
    if (data && data.metadata && data.metadata.user_id) return String(data.metadata.user_id);
    if (data && data.session_id) return String(data.session_id);
  } catch (_) { /* not JSON body or no session id */ }
  return null;
}

function _forward(slot, clientReq, clientRes, bodyBuf) {
  const port = BACKENDS[slot].port;
  const upstreamHeaders = { ...clientReq.headers };
  delete upstreamHeaders['content-length'];
  if (bodyBuf && bodyBuf.length) upstreamHeaders['content-length'] = String(bodyBuf.length);
  upstreamHeaders['x-hme-shuffler-slot'] = slot;
  const upstreamReq = http.request({
    hostname: '127.0.0.1',
    port,
    method: clientReq.method,
    path: clientReq.url,
    headers: upstreamHeaders,
  }, (upstreamRes) => {
    const respHeaders = { ...upstreamRes.headers, 'x-hme-shuffler-slot': slot };
    clientRes.writeHead(upstreamRes.statusCode || 502, respHeaders);
    upstreamRes.pipe(clientRes);
  });
  upstreamReq.on('error', (err) => {
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { 'content-type': 'application/json', 'x-hme-shuffler-slot': slot });
      clientRes.end(JSON.stringify({ error: { type: 'shuffler_backend_error', message: err.message, slot } }));
    } else {
      try { clientRes.destroy(err); } catch (_) { /* response already torn down */ }
    }
  });
  if (bodyBuf && bodyBuf.length) upstreamReq.write(bodyBuf);
  upstreamReq.end();
}

function _handleHealth(req, res) {
  _refreshHealth();
  const out = {
    shuffler_pid: process.pid,
    port: SHUFFLER_PORT,
    backends: {
      a: { port: BACKEND_A_PORT, health: BACKENDS.a.health, routable: _isRoutable('a') },
      b: { port: BACKEND_B_PORT, health: BACKENDS.b.health, routable: _isRoutable('b') },
    },
    routable_count: _routableSlots().length,
    sticky_entries: stickyMap.size,
  };
  const code = _routableSlots().length > 0 ? 200 : 503;
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(out));
}

function _readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(Buffer.alloc(0)));
  });
}

async function _handle(req, res) {
  if (req.method === 'GET' && req.url === '/shuffler/health') return _handleHealth(req, res);
  _refreshHealth();
  const bodyBuf = ['GET', 'HEAD'].includes(req.method) ? null : await _readBody(req);
  const sid = _extractSessionId(req.headers, bodyBuf);
  const slot = _pickSlot(sid);
  if (!slot) {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { type: 'no_backend_available', message: 'Both proxy backends offline or draining; restart with polychron-launch.sh' } }));
    return;
  }
  _forward(slot, req, res, bodyBuf);
}

function _start() {
  _replayStickyMemory();
  _refreshHealth();
  try { fs.mkdirSync(RUNTIME_DIR, { recursive: true }); } catch (_) { /* runtime dir already exists */ }
  try { fs.writeFileSync(SHUFFLER_PID_FILE, String(process.pid)); } catch (_) { /* pid file best-effort */ }
  setInterval(_refreshHealth, HEALTH_POLL_MS).unref();
  const server = http.createServer(_handle);
  server.listen(SHUFFLER_PORT, '127.0.0.1', () => {
    console.log(`[shuffler] listening on 127.0.0.1:${SHUFFLER_PORT} -> backends a=:${BACKEND_A_PORT}, b=:${BACKEND_B_PORT}`);
  });
  server.on('error', (err) => {
    console.error(`[shuffler] listen error: ${err.message}`);
    process.exit(1);
  });
  process.on('SIGTERM', () => { try { fs.unlinkSync(SHUFFLER_PID_FILE); } catch (_) { /* pid file already removed */ } process.exit(0); });
  process.on('SIGINT', () => { try { fs.unlinkSync(SHUFFLER_PID_FILE); } catch (_) { /* pid file already removed */ } process.exit(0); });
}

_start();
