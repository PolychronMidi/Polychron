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

const fs = require('fs');
const path = require('path');
const { workerRequest } = require('./_worker_http');

const CACHE_CAP = 500;
const _cache = new Map();

// Rolling failure telemetry. After STREAK_WARN consecutive failures in a
// window, every subsequent failure also writes one line to hme-errors.log so
// the user-facing LIFESAVER pipeline picks it up.
let _failStreak = 0;
// Shared with _safe_curl in hooks/helpers/_safety.sh via HME_STREAK_WARN in .env.
// Proxy is launched with .env vars set by sessionstart.sh, so the env var is
// reliably present; fallback to 5 matches the bash-side default.
const STREAK_WARN = parseInt(process.env.HME_STREAK_WARN || '5', 10);
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

async function _post(reqPath, body, timeoutMs) {
  // Shared low-level HTTP plumbing in _worker_http.js. This wrapper
  // owns the enrichment-specific failure semantics (null-on-error +
  // rolling streak telemetry). transport vs HTTP-error vs JSON-parse
  // failures all fold into a single _recordFailure call here.
  const { status, json, raw, error } = await workerRequest('POST', reqPath, body, timeoutMs);
  if (error) {
    _recordFailure(reqPath, `transport: ${error.message}`);
    return null;
  }
  if (status >= 400) {
    _recordFailure(reqPath, `HTTP ${status}: ${raw}`);
    return null;
  }
  if (json === null) {
    _recordFailure(reqPath, `JSON parse error (raw=${raw})`);
    return null;
  }
  _recordSuccess();
  return json;
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
