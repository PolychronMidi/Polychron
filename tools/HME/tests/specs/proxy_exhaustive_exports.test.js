// Exhaustive: loads every proxy .js module and asserts no export is undefined.
// Runs in its own file to avoid side-effect interference with other proxy tests.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PROXY_ROOT = path.resolve(__dirname, '..', '..', 'proxy');

// Entry-point files that start servers — skip. Relative paths from PROXY_ROOT.
const SKIP_ENTRIES = new Set([
  'hme_proxy.js',
  'codex_proxy.js',
  'middleware_cli.js',
  'shuffler/shuffler.js',   // calls _start() at module load -> binds 9099
]);

// Files whose require() hangs or spawns workers — skip.
const SKIP_HANGERS = new Set([
  'upstream.js',            // connects to external services
  'upstream_client.js',     // same
  'omniroute_client.js',    // HTTP agent setup
]);

test('every proxy module export is defined', () => {
  const failures = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = () => {};
  console.error = () => {};

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        if (entry.name === 'mcp_server') continue;  // separate module with its own package.json
        walk(full);
      } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) {
        const rel = path.relative(PROXY_ROOT, full).split(path.sep).join('/');
        if (SKIP_ENTRIES.has(rel)) continue;
        if (entry.name.startsWith('test_')) continue;
        if (SKIP_HANGERS.has(entry.name)) continue;
        try {
          const mod = require(full);
          if (mod && typeof mod === 'object') {
            for (const [key, val] of Object.entries(mod)) {
              if (val === undefined) {
                failures.push(`${rel}:${key} is undefined`);
              }
            }
          }
        } catch (err) {
          failures.push(`${rel}: ${err.code || 'THREW'} — ${err.message}`);
        }
      }
    }
  }

  walk(PROXY_ROOT);
  console.log = origLog;
  console.error = origErr;

  assert.equal(failures.length, 0,
    `Modules with undefined exports:\n${failures.join('\n')}`);
});
