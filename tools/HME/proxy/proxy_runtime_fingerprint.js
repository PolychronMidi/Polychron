'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXT_RE = /\.(js|mjs|cjs|json)$/;
const SKIP_DIRS = new Set(['node_modules', 'runtime', 'shuffler']);
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
  files.sort();
  const hash = crypto.createHash('sha256');
  hash.update('hme-proxy-runtime-v1\0');
  for (const abs of files) {
    const rel = path.relative(projectRoot, abs).replace(/\\/g, '/');
    hash.update(rel);
    hash.update('\0');
    try {
      hash.update(fs.readFileSync(abs));
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

module.exports = { computeRuntimeFingerprint, currentRuntimeFingerprint };
