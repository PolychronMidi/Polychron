'use strict';
/**
 * Thin HTTP client for the worker's RAG/validate/enrich endpoints.
 * Used by enrichment middleware that wants semantic-search signal beyond
 * the static JSON maps. Fails silently (returns empty result) when the
 * worker is unreachable — enrichment is non-fatal; tools must always flow.
 *
 * Per-process LRU cache amortizes the 80-100ms semantic-search cost across
 * repeated calls within a session.
 */

const http = require('http');
const { MCP_PORT } = require('./supervisor/children');

const CACHE_CAP = 500;
const _cache = new Map();

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

function _post(path, body, timeoutMs) {
  return new Promise((resolve) => {
    const data = Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request(
      {
        hostname: '127.0.0.1', port: MCP_PORT, path, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
          catch (_e) { resolve(null); }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
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
