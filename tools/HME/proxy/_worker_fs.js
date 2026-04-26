'use strict';
/**
 * Filesystem-IPC client to the Python worker — drop-in replacement for
 * `_worker_http.js`'s `workerRequest` with the same {status, json, raw,
 * error} return shape.
 *
 * Talks to the EXISTING worker-side queue watcher in
 * `tools/HME/service/worker_queue.py`, which is already started by
 * `worker.py:main()`. Wire shape is dictated by worker_queue.py:
 *
 *   request:  tmp/hme-worker-queue/<endpoint>/<jobId>.json
 *             body = {jobId, endpoint, body, ts}
 *   result:   tmp/hme-worker-results/<jobId>.json
 *             body = handler-specific (e.g. {ok, result} for tool calls)
 *
 * Why filesystem IPC vs HTTP for worker dispatch:
 *   - No socket lifecycle: TCP connection state, half-open sockets,
 *     ECONNRESET races all go away
 *   - SIGKILL-survivable on the WORKER side: if worker dies mid-call,
 *     the job file stays in queue/ and the next worker boot's watcher
 *     picks it up (worker_queue.py polls indefinitely)
 *   - Audit trail: every call leaves a result file (caller unlinks)
 *   - Atomic-rename writes: never see partial reads
 *
 * MCP wire spec is preserved at the boundary: Claude Code still talks
 * HTTP/SSE to `/mcp/*`. This module governs only the INTERNAL proxy ↔
 * worker leg, invoked via the transport router when
 * `HME_WORKER_TRANSPORT=filesystem|hybrid`.
 *
 * Endpoint mapping (HTTP path → worker_queue endpoint):
 *   POST /tool/<name>     → endpoint="tool", body={name, args}
 *   POST /enrich          → endpoint="enrich"
 *   POST /enrich_prompt   → endpoint="enrich_prompt"
 *   POST /audit           → endpoint="audit"
 *
 * Endpoints NOT supported by worker_queue.py (and thus NOT FS-eligible):
 *   GET /tools/list, GET /health, GET /version, GET /transcript, etc.
 * The router (`_worker_transport.js`) keeps those on HTTP regardless of
 * the configured mode.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECT_ROOT = process.env.PROJECT_ROOT
  || path.resolve(__dirname, '..', '..', '..');
const QUEUE_DIR = path.join(PROJECT_ROOT, 'tmp', 'hme-worker-queue');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'tmp', 'hme-worker-results');

function _atomicWrite(target, content) {
  const tmp = `${target}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, target);
}

/**
 * Wait for results/<jobId>.json to appear, with timeout. Returns
 * parsed contents on success, or null on timeout. Polls every 25ms
 * for the first second, then 100ms thereafter — fast enough that p99
 * dispatch latency stays under the per-tool work cost while keeping
 * idle CPU low.
 */
function _waitForResult(jobId, timeoutMs) {
  const resultPath = path.join(RESULTS_DIR, `${jobId}.json`);
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      try {
        const text = fs.readFileSync(resultPath, 'utf8');
        try { fs.unlinkSync(resultPath); } catch (_e) { /* race ok */ }
        try { return resolve(JSON.parse(text)); }
        catch (_e) { return resolve({ _parseError: true, raw: text }); }
      } catch (_e) {
        // not yet — continue
      }
      const elapsed = Date.now() - start;
      if (elapsed >= timeoutMs) return resolve(null);
      const next = elapsed < 1000 ? 25 : 100;
      setTimeout(tick, next);
    };
    tick();
  });
}

/**
 * Translate an HTTP-style (method, path, body) into a worker_queue
 * envelope. Returns null if the endpoint isn't FS-eligible — caller
 * (the router) interprets null as "fall back to HTTP".
 */
function _toEnvelope(method, reqPath, body) {
  if (method === 'POST' && reqPath.startsWith('/tool/')) {
    const name = decodeURIComponent(reqPath.slice('/tool/'.length));
    return { endpoint: 'tool', body: { name, args: body || {} } };
  }
  if (method === 'POST' && reqPath === '/enrich') {
    return { endpoint: 'enrich', body: body || {} };
  }
  if (method === 'POST' && reqPath === '/enrich_prompt') {
    return { endpoint: 'enrich_prompt', body: body || {} };
  }
  if (method === 'POST' && reqPath === '/audit') {
    return { endpoint: 'audit', body: body || {} };
  }
  return null;
}

/**
 * Drop-in for `_worker_http.workerRequest`. Returns
 * {status, json, raw, error}.
 */
async function workerRequest(method, reqPath, body, timeoutMs = 30_000) {
  const env = _toEnvelope(method, reqPath, body);
  if (env === null) {
    return {
      status: 0, json: null, raw: '',
      error: new Error(`fs-transport: ${method} ${reqPath} not FS-eligible`),
    };
  }
  const jobId = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const job = {
    jobId,
    endpoint: env.endpoint,
    body: env.body,
    ts: Date.now() / 1000,
  };
  const queuePath = path.join(QUEUE_DIR, env.endpoint, `${jobId}.json`);
  try {
    _atomicWrite(queuePath, JSON.stringify(job));
  } catch (err) {
    return { status: 0, json: null, raw: '', error: err };
  }
  const result = await _waitForResult(jobId, timeoutMs);
  if (result === null) {
    return {
      status: 0, json: null, raw: '',
      error: new Error(`fs-transport: timeout after ${timeoutMs}ms (${jobId})`),
    };
  }
  if (result._parseError) {
    return {
      status: 0, json: null, raw: result.raw.slice(0, 500),
      error: new Error('fs-transport: malformed worker result'),
    };
  }
  // worker_queue.py's _dispatch returns:
  //   tool:    {ok: bool, result?: any, error?: str}
  //   enrich:  whatever _enrich() returns directly
  //   error:   {error: str}
  // Translate to {status, json} the http-shape callers expect.
  if (result && result.error && result.ok !== true) {
    return {
      status: 500, json: result, raw: String(result.error), error: null,
    };
  }
  return { status: 200, json: result, raw: '', error: null };
}

module.exports = { workerRequest, QUEUE_DIR, RESULTS_DIR };
