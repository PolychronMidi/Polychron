'use strict';
// Shared primitives: activity emission, session identity, path constants.

const { spawn } = require('child_process');
const path = require('path');
const { loadJsonc } = require('./config_loader');
const hmePaths = require('./infra/hme_paths');

const PROJECT_ROOT = hmePaths.PROJECT_ROOT;
const EMIT_PY = path.join(PROJECT_ROOT, 'tools/HME/activity/emit.py');

// Durable inter-script state lives here, NOT in tmp/. tmp/ is genuinely
// throwaway (rotating dumps, scratch). See tools/HME/runtime/INVENTORY.md.
const RUNTIME_DIR = hmePaths.HME_RUNTIME_DIR;

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

function _sessionField(obj) {
  if (!obj || typeof obj !== 'object') return '';
  for (const k of ['session_id', 'sessionId', 'thread_id', 'threadId', 'conversation_id', 'conversationId']) {
    if (typeof obj[k] === 'string' && obj[k].trim()) return obj[k].trim();
  }
  return '';
}

function _sessionFromJsonString(value) {
  if (typeof value !== 'string' || !value.trim().startsWith('{')) return '';
  try { return _sessionField(JSON.parse(value)); }
  catch (_err) { return ''; }
}

function payloadSessionId(payload) {
  const direct = _sessionField(payload);
  if (direct) return direct;
  const metadata = payload && payload.metadata;
  const fromMetadata = _sessionField(metadata);
  if (fromMetadata) return fromMetadata;
  if (metadata && typeof metadata === 'object') {
    for (const k of ['user_id', 'userId', 'user']) {
      const sid = _sessionFromJsonString(metadata[k]);
      if (sid) return sid;
    }
  }
  for (const k of ['user_id', 'userId']) {
    const sid = _sessionFromJsonString(payload && payload[k]);
    if (sid) return sid;
  }
  return '';
}

function sessionKey(payload) {
  const explicitSession = payloadSessionId(payload);
  if (explicitSession) return explicitSession;
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
  const rootAbs = path.resolve(root);
  const expanded = String(filePath)
    .replace(/\$\{PROJECT_ROOT\}/g, rootAbs)
    .replace(/\$PROJECT_ROOT/g, rootAbs);
  const rel = path.relative(rootAbs, path.resolve(expanded));
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
  payloadSessionId,
  sessionKey,
  PROJECT_ROOT,
  EMIT_PY,
  RUNTIME_DIR,
  HME_METRICS_DIR: hmePaths.HME_METRICS_DIR,
  HME_STATE_DIR: hmePaths.HME_STATE_DIR,
  COMPOSITION_METRICS_DIR: hmePaths.COMPOSITION_METRICS_DIR,
  mtimeCache,
  projectPathSegments,
  hasMisplacedRootOnlyDir,
  loadModelsJson,
};
