// CONVENTIONS: see ../../proxy/CONVENTIONS.md -- this test require()s every
// *.js file in tools/HME/proxy/. Catches broken import paths, syntax errors,
// undefined exports from cycles, and missing files in ANY proxy module --
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PROXY_DIR = path.resolve(__dirname, '..', '..', 'proxy');

// Files that intentionally MUST NOT be require()d at test time:
// - hme_proxy.js / codex_proxy.js: top-level main scripts that bind sockets on load.
const REQUIRE_BLOCKLIST = new Set([
  'hme_proxy.js',          // main proxy entry, binds :PORT on load
  'codex_proxy.js',        // codex proxy entry, binds :PORT on load
]);

function listJsFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listJsFiles(full, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('every proxy *.js file loads without throwing or producing undefined exports', () => {
  const files = listJsFiles(PROXY_DIR);
  assert.ok(files.length > 50, `expected > 50 proxy files, got ${files.length}`);
  const failures = [];
  for (const file of files) {
    const rel = path.relative(PROXY_DIR, file);
    if (REQUIRE_BLOCKLIST.has(rel)) continue;
    let mod;
    try {
      mod = require(file);
      // silent-ok: exhaustive require test records load error and continues scanning remaining files.
    } catch (err) {
      failures.push(`${rel}: require threw ${err && err.message ? err.message : err}`);
      continue;
    }
    if (mod === undefined) {
      failures.push(`${rel}: module.exports === undefined (cycle?)`);
      continue;
    }
    // If the module exports an object, every named export must NOT be
    // literally undefined. undefined named exports are the signature
    if (mod && typeof mod === 'object') {
      for (const key of Object.keys(mod)) {
        if (mod[key] === undefined) {
          failures.push(`${rel}: export "${key}" resolved as undefined (cycle?)`);
        }
      }
    }
  }
  assert.equal(failures.length, 0,
    `exhaustive proxy require found ${failures.length} failure(s):\n  - ${failures.join('\n  - ')}`);
});
