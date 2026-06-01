'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXT_RE = /\.(js|mjs|cjs|json)$/;
const SKIP_DIRS = new Set(['node_modules', 'runtime', 'shuffler']);
const EXTRA_RUNTIME_FILES = [
  path.join('tools', 'HME', 'launcher', 'polychron-launch.sh'),
  path.join('tools', 'HME', 'launcher', 'polychron-slot-restart.sh'),
  path.join('tools', 'HME', 'hooks', 'direct', 'proxy-supervisor.sh'),
  path.join('tools', 'HME', 'hooks', 'helpers', '_self_tags.sh'),
  path.join('tools', 'HME', 'hooks', 'pretooluse', 'bash', 'post', 'gates.sh'),
  path.join('tools', 'HME', 'hooks', 'pretooluse', 'bash', 'pre', 'registry_mirror.sh'),
  // Shortcut definitions are read at middleware load time; a JSON-only edit must
  // flip the fingerprint so slots rotate and pick up the new shortcuts (no drift
  path.join('tools', 'HME', 'config', 'shortcuts.json'),
  // .env governs proxy behavior (HME_PROXY_* flags read at boot); changes
  // must flip runtime_stale so the file-watcher rotates slots automatically.
  '.env',
];
let cache = { root: '', ts: 0, value: '' };

function _walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { return; }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      _walk(abs, out);
    } else if (entry.isFile() && EXT_RE.test(entry.name)) {
      out.push(abs);
    }
  }
}

function computeRuntimeFingerprint(projectRoot) {
  const proxyRoot = path.join(projectRoot, 'tools', 'HME', 'proxy');
  const files = [];
  _walk(proxyRoot, files);
  for (const rel of EXTRA_RUNTIME_FILES) files.push(path.join(projectRoot, rel));
  files.sort();
  const hash = crypto.createHash('sha256');
  hash.update('hme-proxy-runtime-v1\0');
  for (const abs of files) {
    const rel = path.relative(projectRoot, abs).replace(/\\/g, '/');
    hash.update(rel);
    hash.update('\0');
    try {
      hash.update(fs.readFileSync(abs));
    // silent-ok: proxy path logs or preserves raw response; caller keeps explicit status.
    } catch (_e) {
      hash.update('missing');
    }
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}

function currentRuntimeFingerprint(projectRoot) {
  const now = Date.now();
  if (cache.root === projectRoot && cache.value && (now - cache.ts) < 2000) return cache.value;
  cache = { root: projectRoot, ts: now, value: computeRuntimeFingerprint(projectRoot) };
  return cache.value;
}

// Absolute paths of the EXTRA (non-proxy-tree) files that feed the fingerprint.
// The file-watcher MUST watch these too, or a change to one flips "wanted"
// without ever triggering slot rotation -> permanent silent drift.
function extraRuntimeFiles(projectRoot) {
  return EXTRA_RUNTIME_FILES.map((rel) => path.join(projectRoot, rel));
}

module.exports = {
  computeRuntimeFingerprint,
  currentRuntimeFingerprint,
  extraRuntimeFiles,
  EXTRA_RUNTIME_FILES,
};
