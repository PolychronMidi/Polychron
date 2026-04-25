'use strict';
/**
 * Dominance layer: desperation cache / pre-emptive fetch.
 *
 * When the user's latest turn contains action-shaped language ("why did
 * X break", "look at module Y", "find callers of Z"), the agent is
 * highly likely to reach for Read/Grep/Glob/Bash tools in its response.
 * Pre-fire the corresponding HME queries IN PARALLEL with the agent's
 * inference. Cache results for 60s so when the agent's tool call
 * actually arrives at the proxy path, the work has already been done.
 *
 * The agent reaches for the tool; the tool falls into hand because
 * the tool was already running before the agent decided to reach.
 *
 * Feature-flagged: env HME_DOMINANCE=1 gates the whole dominance layer.
 *
 * The cache is per-proxy-process, NOT persisted across restarts. A
 * restart drops the cache; no staleness risk persists beyond the
 * process lifetime.
 *
 * Does NOT duplicate OVERDRIVE_VIA_SUBAGENT. Those sentinels route
 * through the subagent bridge separately. This is for cheap HTTP
 * calls to the local HME worker (localhost:9098) — single-digit-ms
 * priming of KB briefs, symbol lookups, dir summaries.
 */

const http = require('http');

const DOMINANCE_ENABLED = process.env.HME_DOMINANCE === '1';
// `||` treats the string '0' as truthy (non-empty), so HME_MCP_PORT='0'
// would pass through as Number('0') → 0, making http.request route to
// "any free port" — every prefetch then silently 404s/errors and the
// on('error') handler swallows it. Validate explicitly: accept only
// 1-65535, fall back to 9098 otherwise.
const _PORT_RAW = process.env.HME_MCP_PORT;
const _PORT_NUM = Number(_PORT_RAW);
const WORKER_PORT = (Number.isInteger(_PORT_NUM) && _PORT_NUM >= 1 && _PORT_NUM <= 65535)
  ? _PORT_NUM
  : 9098;
const CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 32;

// key → { body, expiry }
const _cache = new Map();

function _cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) { _cache.delete(key); return null; }
  return entry.body;
}

function _cacheSet(key, body) {
  if (_cache.size >= MAX_CACHE_ENTRIES) {
    // Drop oldest (Map preserves insertion order).
    const first = _cache.keys().next().value;
    if (first) _cache.delete(first);
  }
  _cache.set(key, { body, expiry: Date.now() + CACHE_TTL_MS });
}

function _post(pathName, payload, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req = http.request({
      host: '127.0.0.1', port: WORKER_PORT, path: pathName, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      timeout: timeoutMs,
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c.toString('utf8'); });
      res.on('end', () => {
        // Only cache 2xx responses. A worker 4xx/5xx (or an HTML error
        // page from a misrouted port) would otherwise be cached for
        // 60s and served as a "hit" to sibling middleware, poisoning
        // every downstream consumer for the TTL.
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(raw);
        } else {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

// Scan the latest user message for semantic triggers and return a list
// of (cacheKey, fetchFn) pairs to pre-fire.
function _triggersFromPayload(payload) {
  const msgs = (payload && payload.messages) || [];
  const last = msgs[msgs.length - 1];
  if (!last || last.role !== 'user') return [];
  const content = last.content;
  const text = typeof content === 'string' ? content
    : Array.isArray(content)
      ? content.filter((b) => b && b.type === 'text').map((b) => b.text || '').join(' ')
      : '';
  if (!text) return [];
  const out = [];

  // "why did X break" / "look at X" / "find X" / "investigate X"
  const action = text.match(/\b(?:why (?:did|is|does)|look at|find|investigate|check|inspect)\s+(\w[\w./\-]{1,60})/i);
  if (action) {
    const target = action[1];
    out.push({
      key: `enrich:${target}`,
      fetch: () => _post('/enrich', { query: target, top_k: 3 }),
    });
  }

  // Bare filename-like tokens at reasonable length
  const fileMatch = text.match(/\b([a-zA-Z_][\w\-]{2,40}\.(?:js|ts|py|sh|json|md))\b/);
  if (fileMatch) {
    out.push({
      key: `enrich:${fileMatch[1]}`,
      fetch: () => _post('/enrich', { query: fileMatch[1], top_k: 3 }),
    });
  }

  return out;
}

module.exports = {
  name: 'dominance_prefetch',

  onRequest({ payload, ctx }) {
    if (!DOMINANCE_ENABLED) return;
    const triggers = _triggersFromPayload(payload);
    if (triggers.length === 0) return;
    // Fire and forget — don't block the request. Results land in
    // `_cache` for a future middleware or tool call to pick up.
    for (const t of triggers) {
      if (_cacheGet(t.key)) continue;
      t.fetch().then((body) => {
        if (body) _cacheSet(t.key, body);
      }).catch(() => { /* silent-ok: best-effort prefetch */ });
    }
    ctx.emit({ event: 'dominance_prefetch_fired', targets: triggers.map((t) => t.key).join('|') });
  },

  // Exposed for cache hits from sibling middleware / test harness.
  _cacheGet,
  _cacheSet,
};
