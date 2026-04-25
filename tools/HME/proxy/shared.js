'use strict';
// Shared primitives: activity emission, session identity, path constants.

const { spawn } = require('child_process');
const path = require('path');

const PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '..', '..', '..');
const EMIT_PY = path.join(PROJECT_ROOT, 'tools/HME/activity/emit.py');

function emit(fields) {
  try {
    const args = [EMIT_PY];
    for (const [k, v] of Object.entries(fields)) {
      args.push(`--${k}=${v}`);
    }
    const p = spawn('python3', args, { detached: true, stdio: 'ignore' });
    p.on('error', () => {});
    p.unref();
  } catch (_err) {
    // ignore
  }
}

function shortHash(s) {
  let h = 0;
  const n = Math.min(s.length, 500);
  for (let i = 0; i < n; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

function sessionKey(payload) {
  const msgs = payload && payload.messages;
  if (!Array.isArray(msgs)) return 'unknown';
  for (const m of msgs) {
    if (m && m.role === 'user') {
      const c = m.content;
      const s = typeof c === 'string' ? c : JSON.stringify(c || '');
      return shortHash(s);
    }
  }
  return 'unknown';
}

// Shared mtime-checked file cache. Multiple middleware (dir_context,
// grep_glob_neighborhood, dominance_prefetch, edit_context, etc.) had
// each rolled their own clock-only TTL caches that served stale data
// indefinitely after the underlying file rotated. The thread-routed
// architecture review surfaced this as Pattern C: "in-memory state
// with no invalidation against external filesystem truth, recurring
// across multiple files." This primitive centralizes the correct
// pattern: cache by path, invalidate on mtime change, optional clock
// TTL as fallback for expensive parses.
//
// Usage:
//   const cache = mtimeCache({ ttlMs: 60_000 });
//   const value = cache.get(absPath, () => parseExpensively(absPath));
//
// The loader is called only when the cached entry is missing, the file
// mtime moved past the cached mtime, OR the optional clock TTL elapsed.
// Loader exceptions propagate; cache.get does not swallow them.
const fsForCache = require('fs');
function mtimeCache({ ttlMs = 0 } = {}) {
  const _entries = new Map();
  return {
    get(absPath, loader) {
      // Pre-stat: only used to detect whether the cached entry is stale,
      // not as the mtime we STORE. Storing a pre-loader mtime created a
      // TOCTOU hole — if the file was rewritten between the stat and the
      // loader's read, cache would record an old mtime against new
      // content. Post-stat below pins to the version the loader saw.
      let preMtime = 0;
      try { preMtime = fsForCache.statSync(absPath).mtimeMs; }
      catch (_) { /* file may not exist; loader will handle */ }
      const now = Date.now();
      const e = _entries.get(absPath);
      if (e
          && e.mtime === preMtime
          && preMtime !== 0 // never trust a missing-file stat as a cache match
          && (ttlMs === 0 || now - e.loadedAt < ttlMs)) {
        return e.value;
      }
      const value = loader();
      // Post-stat: capture mtime AFTER loader has finished reading. If
      // the file is rewritten between loader-read and this stat, the
      // cache will briefly under-serve (next get re-loads), which is
      // the safe direction vs serving known-stale content.
      let postMtime = 0;
      try { postMtime = fsForCache.statSync(absPath).mtimeMs; }
      catch (_) { /* file may have been deleted; store 0 so next get re-loads */ }
      _entries.set(absPath, { value, mtime: postMtime, loadedAt: now });
      return value;
    },
    invalidate(absPath) { _entries.delete(absPath); },
    clear() { _entries.clear(); },
    size() { return _entries.size; },
  };
}

module.exports = { emit, shortHash, sessionKey, PROJECT_ROOT, EMIT_PY, mtimeCache };
