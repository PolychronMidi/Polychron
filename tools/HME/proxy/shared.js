'use strict';
// Shared primitives: activity emission, session identity, path constants.

const { spawn } = require('child_process');
const path = require('path');
const { loadJsonc } = require('./config_loader');

const PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '..', '..', '..');
const EMIT_PY = path.join(PROJECT_ROOT, 'tools/HME/activity/emit.py');
// Durable inter-script state lives here, NOT in tmp/. tmp/ is genuinely
// throwaway (rotating dumps, scratch). See runtime/hme/INVENTORY.md.
const RUNTIME_DIR = path.join(PROJECT_ROOT, 'runtime', 'hme');

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
    // silent-ok: optional fallback path.
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

// mtime-checked file cache; invalidate on mtime change, optional clock TTL.
// Usage: mtimeCache({ttlMs:60_000}).get(absPath, () => parseExpensively(p))
const fsForCache = require('fs');
function mtimeCache({ ttlMs = 0 } = {}) {
  const _entries = new Map();
  return {
    get(absPath, loader) {
      // Pre-stat: stale-detection only. Storing pre-loader mtime is a TOCTOU
      // hole; post-stat below pins to the version loader actually saw.
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
      // Post-stat: pins to the mtime loader saw. If file is rewritten
      // between read+stat, cache under-serves (safe; next get re-loads).
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

function projectPathSegments(filePath, root = PROJECT_ROOT) {
  if (!filePath || !root) return [];
  const rel = path.relative(path.resolve(root), path.resolve(String(filePath)));
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return [];
  return rel.split(path.sep).filter(Boolean);
}

function hasMisplacedRootOnlyDir(filePath, names, root = PROJECT_ROOT) {
  const wanted = new Set(names);
  return projectPathSegments(filePath, root).some((part, idx) => idx > 0 && wanted.has(part));
}

function loadModelsJson() {
  return loadJsonc(path.resolve(PROJECT_ROOT, 'config', 'models.json'));
}

module.exports = {
  emit,
  shortHash,
  sessionKey,
  PROJECT_ROOT,
  EMIT_PY,
  RUNTIME_DIR,
  mtimeCache,
  projectPathSegments,
  hasMisplacedRootOnlyDir,
  loadModelsJson,
};
