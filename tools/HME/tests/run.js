#!/usr/bin/env node
'use strict';
/**
 * HME unit-test runner. Loads every spec via require() so node:test sees one
 * combined test plan; spec files self-register via `test()` and the platform
 * runs them.
 *
 * Search-tokens (consumed by tools/HME/tests/specs/run_js_tripwire.test.js):
 *   [hme-tests] loading
 *   HME_TEST_LAST_LOADED_SPEC
 *   still running after
 *
 * Run: node tools/HME/tests/run.js
 *      npm run test:hme
 */

const path = require('path');
const fs = require('fs');

if (!process.env.PROJECT_ROOT) {
  process.env.PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
}

const TESTS_DIR = path.join(__dirname, 'specs');
const files = fs.readdirSync(TESTS_DIR)
  .filter((f) => f.endsWith('.test.js'))
  .sort();

const _RUN_STARTED_MS = Date.now();
let _activeSpec = '(bootstrap)';
const _heartbeat = setInterval(() => {
  const elapsed = Date.now() - _RUN_STARTED_MS;
  console.error(`[hme-tests] still running after ${elapsed}ms; last_loaded=${_activeSpec}`);
}, 30_000);
_heartbeat.unref();

if (files.length === 0) {
  console.error('[hme-tests] no *.test.js files in specs/');
  process.exit(1);
}

const _STUB_PRONE_KEYS = [
  'validator', 'rf', 'm', 'sectionIndex', 'phraseIndex', 'measureIndex', 'beatIndex',
];
require('../../../src/utils');
const _stubBaseline = {};
for (const k of _STUB_PRONE_KEYS) {
  _stubBaseline[k] = {
    had: Object.prototype.hasOwnProperty.call(global, k),
    value: global[k],
  };
}

for (const f of files) {
  _activeSpec = `specs/${f}`;
  process.env.HME_TEST_LAST_LOADED_SPEC = _activeSpec;
  const started = Date.now();
  console.error(`[hme-tests] loading ${_activeSpec}`);
  require(path.join(TESTS_DIR, f));
  console.error(`[hme-tests] loaded ${_activeSpec} in ${Date.now() - started}ms`);
}

process.on('exit', () => {
  clearInterval(_heartbeat);
  const leaks = [];
  for (const k of _STUB_PRONE_KEYS) {
    const before = _stubBaseline[k];
    const hasNow = Object.prototype.hasOwnProperty.call(global, k);
    if (!before.had && hasNow) {
      leaks.push(`  ${k}: was unset, now present (type=${typeof global[k]})`);
    } else if (before.had && hasNow && global[k] !== before.value) {
      leaks.push(`  ${k}: replaced (was ${typeof before.value}, now ${typeof global[k]})`);
    } else if (before.had && !hasNow) {
      leaks.push(`  ${k}: was present, now deleted`);
    }
  }
  if (leaks.length > 0) {
    console.error(
      `\n[run.js] test-stub global pollution detected -- ${leaks.length} ` +
      `known-stub-prone key(s) diverged across the suite:\n` +
      leaks.join('\n') +
      `\nUse tools/HME/tests/with_globals.js to scope mutations.\n`
    );
  }
});
