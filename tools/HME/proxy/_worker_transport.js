'use strict';
/**
 * Transport router for proxy → worker dispatch. Picks between HTTP
 * (`_worker_http.js`) and filesystem queue (`_worker_fs.js`) based on
 * `HME_WORKER_TRANSPORT` env var:
 *
 *   http     (default)  — legacy localhost HTTP path
 *   hybrid              — FS for endpoints worker_queue.py covers
 *                         (POST /tool/*, /enrich, /enrich_prompt,
 *                         /audit); HTTP for everything else (light
 *                         endpoints + endpoints worker_queue doesn't
 *                         handle). RECOMMENDED when running with the
 *                         worker_queue watcher active (which it is by
 *                         default — worker.py:main() starts it).
 *
 * Pure-FS mode isn't offered: `worker_queue.py` only handles a subset
 * of the worker's HTTP endpoints, so paths like /tools/list, /health,
 * /version MUST go through HTTP regardless. Hybrid mode encapsulates
 * that fact so callers don't need to know.
 *
 * The MCP wire spec is unaffected: Claude Code still talks HTTP/SSE
 * to /mcp/* on the proxy. This router governs only the INTERNAL
 * proxy ↔ worker leg.
 */

const httpBackend = require('./_worker_http');
const fsBackend = require('./_worker_fs');

const MODE = (process.env.HME_WORKER_TRANSPORT || 'http').toLowerCase();
const VALID_MODES = new Set(['http', 'hybrid']);
const RESOLVED = VALID_MODES.has(MODE) ? MODE : 'http';

// Endpoints the FS transport supports — must match the set
// `worker_queue.py:_dispatch` handles. In hybrid mode, ONLY these
// route through FS; everything else (GET /tools/list, GET /health,
// GET /version, GET /transcript, POST /reindex, etc.) stays on HTTP.
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
