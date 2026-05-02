#!/usr/bin/env node
'use strict';
/**
 * HME unit-test runner. Uses node:test (no new dep) to exercise the
 * proxy-side JS layer that currently has no test coverage:
 *   - stop_chain/index.js (policy evaluator)
 *   - policies/registry.js (registration, matching, chain execution)
 *   - policies/config.js (three-scope merge)
 *   - middleware/secret_sanitizer.js (regex catalog)
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
// process.env.PROJECT_ROOT to locate config/. Anchor it to the repo root
// derived from this file's path so the suite is hermetic -- no caller
// needs to export PROJECT_ROOT manually.
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

// Default-on guard against test-stub global pollution.
//
// The 2026-05-01 incident: drum_kit_rotator and rhythm_flair both stub
// `global.validator` inside their loaders; a missing restore left the
// stub on globalThis, and metaprofile_next_level's pair_gain_ceiling
// test then loaded src/index -- which called validator.create(...)
// .optionalFinite, which the stub didn't carry. Crash. The fix at the
// time was per-callsite save/restore; this tripwire is the structural
// guarantee it can't recur.
//
// Watching only the small set of keys tests are KNOWN to stub. (Watching
// every key on globalThis is a non-starter -- src/index legitimately
// registers ~500 modules as globals during DI bootstrap.)
//
// Critically, baseline is captured AFTER loading src/utils so the REAL
// `validator` binding lands in the snapshot. Subsequent test stubs that
// replace `validator` and don't restore = tripwire fires. Test stubs
// that DO restore (back to the same real validator object) = tripwire
// stays silent. Without this pre-load, validator-real-after looks like
// a leak vs validator-undef-before.
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
