'use strict';
// Filesystem IPC worker client mirroring workerRequest's {status,json,raw,error} shape.
// Only queue-backed POST endpoints use FS; HTTP remains for health/tools/version/transcr

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
 * for the first second, then 100ms thereafter -- fast enough that p99
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
        // silent-ok: result file may be mid-write; poll loop retries until timeout.
        // not yet -- continue
      }
      const elapsed = Date.now() - start;
      if (elapsed >= timeoutMs) return resolve(null);
      const next = elapsed < 1000 ? 25 : 100;
      setTimeout(tick, next);
    };
    tick();
  });
}

// Translate HTTP-style (method,path,body) to a worker_queue envelope.
// Returns null when the router must fall back to HTTP.
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

// Drop-in for `_worker_http.workerRequest`; returns {status, json, raw, error}.
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
    // silent-ok: queue write failure is returned as transport error object to caller.
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
  if (result && result.error && result.ok !== true) {
    return {
      status: 500, json: result, raw: String(result.error), error: null,
    };
  }
  return { status: 200, json: result, raw: '', error: null };
}

module.exports = { workerRequest, QUEUE_DIR, RESULTS_DIR };
