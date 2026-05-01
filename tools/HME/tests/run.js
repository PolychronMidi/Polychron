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
 *      npm run test:hme   (after wiring into package.json — see README)
 *
 * Each test file exports nothing — it registers tests via node:test's
 * `test()` API and they run when executed. This runner just requires
 * each file in order and lets node:test report.
 */

const path = require('path');
const fs = require('fs');

// Several specs (metaprofile fixtures, src/index DI graph) read
// process.env.PROJECT_ROOT to locate config/. Anchor it to the repo root
// derived from this file's path so the suite is hermetic — no caller
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

for (const f of files) {
  require(path.join(TESTS_DIR, f));
}
