#!/usr/bin/env node
'use strict';
/**
 * HME unit-test runner. Uses node:test (no new dep) to exercise the
 * proxy-side JS layer that currently has no test coverage:
 *   - stop_chain/index.js (policy evaluator)
 *   - policies/registry.js (registration, matching, chain execution)
 *   - policies/config.js (three-scope merge)
 *   - middleware/06_secret_sanitizer.js (regex catalog)
 *   - proxy/worker_queue.js (drop+wait round-trip)
 *
 * Run: node tools/HME/tests/run.js
 *      npm run test:hme   (after wiring into package.json -- see README)
 *
 * Each test file exports nothing -- it registers tests via node:test's
 * `test()` API and they run when executed. This runner just requires
 * each file in order and lets node:test report.
 */

const path = require('path');
const fs = require('fs');

// Several specs (metaprofile fixtures, src/index DI graph) read
if (!process.env.PROJECT_ROOT) {
  process.env.PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
}

// node:test exits non-zero if any test fails.
const TESTS_DIR = path.join(__dirname, 'specs');
const files = fs.readdirSync(TESTS_DIR)
  .filter((f) => f.endsWith('.test.js'))
  .sort();

if (files.length === 0) {
  console.error('[hme-tests] no *.test.js files in specs/');
  process.exit(1);
}

// Tripwire against test-stub global pollution. Watches a known stub-prone
const _STUB_PRONE_KEYS = [
  'validator',
  'rf',
  'm',
  'sectionIndex',
  'phraseIndex',
  'measureIndex',
  'beatIndex',
];
require('../../../src/utils');  // load real bindings before snapshot
const _stubBaseline = {};
for (const k of _STUB_PRONE_KEYS) {
  _stubBaseline[k] = {
    had: Object.prototype.hasOwnProperty.call(global, k),
    value: global[k],
  };
}

for (const f of files) {
  require(path.join(TESTS_DIR, f));
}

process.on('exit', () => {
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
