'use strict';
/**
 * Thin HTTP client for the worker's RAG/validate/enrich endpoints.
 * Used by enrichment middleware that wants semantic-search signal beyond
 * the static JSON maps.
 *
 * Failure policy: enrichment is non-fatal (tools must always flow) so calls
 * resolve null rather than rejecting. BUT silent-null-forever is a worse
 * failure mode than loud — a quiet 100% drop rate masquerades as "no KB
 * matches found." So we log every transport failure to stderr (captured by
 * log/hme-proxy.out) AND track a rolling failure counter; once it crosses
 * a streak threshold, we surface a warning so the next tool call has a hint
 * that the worker is dead.
 *
 * Per-process LRU cache amortizes the 80-100ms semantic-search cost across
 * repeated calls within a session.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { MCP_PORT } = require('./supervisor/children');

const CACHE_CAP = 500;
const _cache = new Map();

// Rolling failure telemetry. After STREAK_WARN consecutive failures in a
// window, every subsequent failure also writes one line to hme-errors.log so
// the user-facing LIFESAVER pipeline picks it up.
let _failStreak = 0;
const STREAK_WARN = 5;
const _errLogPath = (() => {
  const root = process.env.PROJECT_ROOT || path.resolve(__dirname, '..', '..', '..');
  return path.join(root, 'log', 'hme-errors.log');
})();
function _recordFailure(endpoint, reason) {
  _failStreak += 1;
  const msg = `[${new Date().toISOString()}] [worker_client] ${endpoint} ${reason} (streak=${_failStreak})`;
  console.error(msg);
  if (_failStreak >= STREAK_WARN) {
    try {
      fs.appendFileSync(_errLogPath, msg + '\n');
    } catch (e) {
      console.error(`[worker_client] could not append to hme-errors.log: ${e.message}`);
    }
  }
}
function _recordSuccess() {
  if (_failStreak > 0) {
    console.error(`[worker_client] recovered after ${_failStreak} failures`);
  }
  _failStreak = 0;
}

function _cacheGet(key) {
  if (!_cache.has(key)) return undefined;
  const v = _cache.get(key);
  _cache.delete(key);
  _cache.set(key, v);
  return v;
}

function _cacheSet(key, value) {
  if (_cache.has(key)) _cache.delete(key);
  _cache.set(key, value);
  if (_cache.size > CACHE_CAP) {
    const oldest = _cache.keys().next().value;
    _cache.delete(oldest);
  }
}

function _post(reqPath, body, timeoutMs) {
  return new Promise((resolve) => {
    const data = Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request(
      {
        hostname: '127.0.0.1', port: MCP_PORT, path: reqPath, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8') || '{}';
          try {
            const parsed = JSON.parse(raw);
            if (res.statusCode >= 400) {
              _recordFailure(reqPath, `HTTP ${res.statusCode}: ${raw.slice(0, 120)}`);
              resolve(null); return;
            }
            _recordSuccess();
            resolve(parsed);
          } catch (e) {
            _recordFailure(reqPath, `JSON parse error: ${e.message} (raw=${raw.slice(0, 80)})`);
            resolve(null);
          }
        });
      },
    );
    req.on('error', (e) => { _recordFailure(reqPath, `transport: ${e.message}`); resolve(null); });
    req.on('timeout', () => { req.destroy(); _recordFailure(reqPath, `timeout after ${timeoutMs}ms`); resolve(null); });
    req.write(data);
    req.end();
  });
}

// query: string. Returns { warnings: [...], blocks: [...] } or null on failure.
async function validate(query, { timeoutMs = 1500 } = {}) {
  if (!query) return null;
  const key = `v:${query.slice(0, 200)}`;
  const cached = _cacheGet(key);
  if (cached !== undefined) return cached;
  const result = await _post('/validate', { query }, timeoutMs);
  _cacheSet(key, result);
  return result;
}

// query: string. topK: int. Returns { kb: [...], warm: string } or null on failure.
async function enrich(query, topK = 3, { timeoutMs = 1500 } = {}) {
  if (!query) return null;
  const key = `e:${topK}:${query.slice(0, 200)}`;
  const cached = _cacheGet(key);
  if (cached !== undefined) return cached;
  const result = await _post('/enrich', { query, top_k: topK }, timeoutMs);
  _cacheSet(key, result);
  return result;
}

module.exports = { validate, enrich };
