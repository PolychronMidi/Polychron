#!/usr/bin/env node
'use strict';
/**
 * HME unit-test runner. Spawns `node --test --test-isolation=process` so
 * every spec file runs in its own child process; this prevents global
 * state pollution (validator/rf/m/etc. stubs) from one spec breaking
 * later specs. The parent forwards child stdout/stderr live, and emits
 * tripwire diagnostics the suite relies on for timeout triage.
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
const { spawn } = require('child_process');

if (!process.env.PROJECT_ROOT) {
  process.env.PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
}

// Load root .env so child node --test processes inherit fail-fast env keys
// (HME_METRICS_DIR, HME_WORKER_PORT, etc.) that Python verifiers/tooling
const { loadEnv, defaultEnvPath } = require('../proxy/shared/load_env.js');
loadEnv(defaultEnvPath(path.join(__dirname, '..', 'proxy', 'shared')));

const TESTS_DIR = path.join(__dirname, 'specs');
const files = fs.readdirSync(TESTS_DIR)
  .filter((f) => f.endsWith('.test.js'))
  .sort();

if (files.length === 0) {
  console.error('[hme-tests] no *.test.js files in specs/');
  process.exit(1);
}

const _RUN_STARTED_MS = Date.now();
let _activeSpec = '(bootstrap)';
const _heartbeat = setInterval(() => {
  const elapsed = Date.now() - _RUN_STARTED_MS;
  console.error(`[hme-tests] still running after ${elapsed}ms; last_loaded=${_activeSpec}`);
}, 30_000);
_heartbeat.unref();

// Per-spec progress emission. Child node:test with --test-isolation=process
// forks each file, but it does not announce file boundaries on stderr.
for (const f of files) {
  _activeSpec = `specs/${f}`;
  process.env.HME_TEST_LAST_LOADED_SPEC = _activeSpec;
  console.error(`[hme-tests] loading ${_activeSpec}`);
}
process.env.HME_TEST_LAST_LOADED_SPEC = '(child-driven)';

const fileArgs = files.map((f) => path.join(TESTS_DIR, f));
const child = spawn(
  process.execPath,
  ['--test', '--test-isolation=process', '--test-reporter=spec', ...fileArgs],
  { stdio: 'inherit', env: process.env },
);

child.on('exit', (code, signal) => {
  clearInterval(_heartbeat);
  if (signal) process.kill(process.pid, signal);
  else process.exit(code == null ? 1 : code);
});
