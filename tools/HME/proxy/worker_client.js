'use strict';
const { requireEnv: _hmeRequireEnv } = require('./shared/load_env.js');
/**
 * Thin HTTP client for the worker's RAG/validate/enrich endpoints.
 * Used by enrichment middleware that wants semantic-search signal beyond
 * the static JSON maps.
 *
 * Failure policy: enrichment is non-fatal (tools must always flow) so calls
 * resolve null rather than rejecting. BUT silent-null-forever is a worse
 * failure mode than loud -- a quiet 100% drop rate masquerades as "no KB
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
// Route through the transport selector. /validate + /enrich aren't FS-eligible
const { workerRequest } = require('./_worker_transport');

// Timeout SSoT: config/timeouts.json keeps client_ms aligned with the
function _loadTimeouts() {
  try {
    const cfgPath = path.join(__dirname, '..', 'config', 'timeouts.json');
    return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch (e) {
    console.warn(`[worker_client] timeouts.json read failed (${e.message}); using defaults`);
    return {};
  }
}
const _TIMEOUTS = _loadTimeouts();
const _VALIDATE_TIMEOUT_MS = (_TIMEOUTS.validate && _TIMEOUTS.validate.client_ms) || 3500;
const _ENRICH_TIMEOUT_MS = (_TIMEOUTS.enrich && _TIMEOUTS.enrich.client_ms) || 3500;

const CACHE_CAP = 500;
const _cache = new Map();

// Rolling failure telemetry. After STREAK_WARN consecutive failures in a
let _failStreak = 0;
// Shared with _safe_curl failure threshold; override only for local diagnostics.
const STREAK_WARN = parseInt(_hmeRequireEnv('HME_CURL_STREAK_WARN'), 10);
const _errLogPath = (() => {
  const root = _hmeRequireEnv('PROJECT_ROOT');
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

async function validate(query, { timeoutMs = _VALIDATE_TIMEOUT_MS } = {}) {
  if (!query) return null;
  const key = `v:${query.slice(0, 200)}`;
  const cached = _cacheGet(key);
  if (cached !== undefined) return cached;
  const result = await _post('/validate', { query }, timeoutMs);
  _cacheSet(key, result);
  return result;
}

async function enrich(query, topK = 3, { timeoutMs = _ENRICH_TIMEOUT_MS } = {}) {
  if (!query) return null;
  const key = `e:${topK}:${query.slice(0, 200)}`;
  const cached = _cacheGet(key);
  if (cached !== undefined) return cached;
  const result = await _post('/enrich', { query, top_k: topK }, timeoutMs);
  _cacheSet(key, result);
  return result;
}

module.exports = { validate, enrich };
