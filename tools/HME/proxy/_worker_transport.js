'use strict';
const { requireEnv: _hmeRequireEnv } = require('./shared/load_env.js');
// Proxy->worker transport router: HTTP by default, hybrid FS queue for queue-backed POST
// MCP wire stays HTTP/SSE; this only chooses the internal proxy-worker leg.

const httpBackend = require('./_worker_http');
const fsBackend = require('./_worker_fs');

const MODE = (_hmeRequireEnv('HME_WORKER_TRANSPORT')).toLowerCase();
const VALID_MODES = new Set(['http', 'hybrid']);
const RESOLVED = VALID_MODES.has(MODE) ? MODE : 'http';

// Endpoints the FS transport supports -- must match the set
function _fsEligible(method, reqPath) {
  if (method === 'POST' && reqPath.startsWith('/tool/')) return true;
  if (method === 'POST' && reqPath === '/enrich') return true;
  if (method === 'POST' && reqPath === '/enrich_prompt') return true;
  if (method === 'POST' && reqPath === '/audit') return true;
  return false;
}

async function workerRequest(method, reqPath, body, timeoutMs) {
  if (RESOLVED === 'hybrid' && _fsEligible(method, reqPath)) {
    return fsBackend.workerRequest(method, reqPath, body, timeoutMs);
  }
  return httpBackend.workerRequest(method, reqPath, body, timeoutMs);
}

function getMode() { return RESOLVED; }

module.exports = { workerRequest, getMode };
