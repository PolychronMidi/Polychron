'use strict';
/**
 * Shared low-level HTTP client to the Python worker (port WORKER_PORT,
 * default 9098). Single source of truth for socket setup, timeout
 * handling, content-length headers, and JSON parsing — used by both
 * `mcp_server/dispatcher.js` (throw-on-error semantics) and
 * `worker_client.js` (null-on-error semantics, with telemetry).
 *
 * Failure semantics are caller-controlled: this module returns a
 * structured result and does not log or throw — callers wrap it.
 *
 * Returns: Promise<{status, json, raw, error}>
 *   - status: HTTP status code (number) on response, 0 on transport failure
 *   - json:   parsed body (object) or null if non-JSON / parse-failed
 *   - raw:    raw body string (truncated to 500 chars for diagnostics)
 *   - error:  null on success, Error instance on transport-level failure
 *
 * Bug-proofing rationale:
 *   - Single timeout path (req.on('timeout', destroy + reject)) — no double-fire
 *   - JSON parse never throws — caller checks `json === null` for parse failure
 *   - Transport-level errors (ECONNREFUSED, ETIMEDOUT, etc.) surface as
 *     `{status: 0, error: <Error>}` rather than rejecting the promise.
 *     Callers that want throw-semantics check the result and throw.
 *   - Same Content-Length / body encoding rules in one place — adding a
 *     new endpoint can't drift away from them.
 */

const http = require('http');
const { WORKER_PORT } = require('./supervisor/children');

function workerRequest(method, reqPath, body, timeoutMs = 30_000) {
  return new Promise((resolve) => {
    const data = body === null || body === undefined
      ? null
      : Buffer.from(JSON.stringify(body), 'utf8');
    const headers = { 'content-type': 'application/json' };
    if (data !== null) headers['content-length'] = String(data.length);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: WORKER_PORT,
        path: reqPath,
        method,
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = null;
          if (raw) {
            try { json = JSON.parse(raw); }
            catch (_e) { /* json stays null; caller decides */ }
          }
          resolve({
            status: res.statusCode || 0,
            json,
            raw: raw.slice(0, 500),
            error: null,
          });
        });
      },
    );
    let resolved = false;
    const finish = (err) => {
      if (resolved) return;
      resolved = true;
      try { req.destroy(); } catch (_e) { /* ignore */ }
      resolve({ status: 0, json: null, raw: '', error: err });
    };
    req.on('error', (err) => finish(err));
    req.on('timeout', () => finish(new Error(`worker timeout after ${timeoutMs}ms (${method} ${reqPath})`)));
    if (data !== null) req.write(data);
    req.end();
  });
}

module.exports = { workerRequest };
