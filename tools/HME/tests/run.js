#!/usr/bin/env node
'use strict';
/**
 * HME unit-test runner. Runs every spec in an isolated child process so global
 * test stubs cannot leak between files. Progress is per-spec and heartbeat
 * reports the current active spec; a per-file watchdog kills stalls and prints
 * recent output.
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

const SPEC_TIMEOUT_MS = Number.parseInt(process.env.HME_TEST_SPEC_TIMEOUT_MS || '120000', 10);
const HEARTBEAT_MS = Number.parseInt(process.env.HME_TEST_HEARTBEAT_MS || '30000', 10);
const TAIL_LIMIT = 12000;
const _RUN_STARTED_MS = Date.now();
let _activeSpec = '(bootstrap)';
let _activeStarted = _RUN_STARTED_MS;
let _lastOutput = '';

function remember(chunk) {
  _lastOutput = (_lastOutput + chunk).slice(-TAIL_LIMIT);
}

function tailForLog() {
  return _lastOutput.trim() || '(no child output captured)';
}

const _heartbeat = setInterval(() => {
  const elapsed = Date.now() - _RUN_STARTED_MS;
  const activeFor = Date.now() - _activeStarted;
  console.error(`[hme-tests] still running after ${elapsed}ms; last_loaded=${_activeSpec}; active_for=${activeFor}ms`);
}, HEARTBEAT_MS);
_heartbeat.unref();

async function runOne(f) {
  _activeSpec = `specs/${f}`;
  _activeStarted = Date.now();
  _lastOutput = '';
  process.env.HME_TEST_LAST_LOADED_SPEC = _activeSpec;
  console.error(`[hme-tests] loading ${_activeSpec}`);
  const started = Date.now();
  const child = spawn(
    process.execPath,
    ['--test', '--test-isolation=process', '--test-reporter=spec', path.join(TESTS_DIR, f)],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, HME_TEST_LAST_LOADED_SPEC: _activeSpec },
      detached: true,
    },
  );

  child.stdout.on('data', (buf) => {
    const s = buf.toString('utf8');
    remember(s);
    process.stdout.write(s);
  });
  child.stderr.on('data', (buf) => {
    const s = buf.toString('utf8');
    remember(s);
    process.stderr.write(s);
  });

  let timedOut = false;
  const watchdog = setTimeout(() => {
    timedOut = true;
    console.error(`\n[hme-tests] TIMEOUT ${_activeSpec} after ${SPEC_TIMEOUT_MS}ms`);
    console.error(`[hme-tests] output tail for ${_activeSpec}:\n${tailForLog()}\n`);
    try { process.kill(-child.pid, 'SIGKILL'); } catch (_e) { try { child.kill('SIGKILL'); } catch (_e2) { /* gone */ } }
  }, SPEC_TIMEOUT_MS);
  watchdog.unref();

  const result = await new Promise((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal }));
    child.on('error', (error) => resolve({ code: 1, signal: null, error }));
  });
  clearTimeout(watchdog);

  const duration = Date.now() - started;
  if (timedOut) return { ok: false, f, code: 124, signal: 'TIMEOUT', duration };
  if (result.error) {
    console.error(`[hme-tests] child spawn error ${_activeSpec}: ${result.error.message}`);
    return { ok: false, f, code: 1, signal: null, duration };
  }
  const ok = result.code === 0;
  console.error(`[hme-tests] loaded ${_activeSpec} in ${duration}ms exit=${result.code}${result.signal ? ` signal=${result.signal}` : ''}`);
  if (!ok) console.error(`[hme-tests] failure output tail for ${_activeSpec}:\n${tailForLog()}\n`);
  return { ok, f, code: result.code, signal: result.signal, duration };
}

(async () => {
  const failures = [];
  for (const f of files) {
    // Sequential isolation gives honest per-file progress and deterministic
    // blame on stalls. It is intentionally slower than one giant runner.
    const r = await runOne(f);
    if (!r.ok) failures.push(r);
  }
  clearInterval(_heartbeat);
  if (failures.length) {
    console.error(`\n[hme-tests] ${failures.length} spec file(s) failed:`);
    for (const r of failures) {
      console.error(`  specs/${r.f} exit=${r.code}${r.signal ? ` signal=${r.signal}` : ''} duration=${r.duration}ms`);
    }
    process.exit(1);
  }
  console.error(`[hme-tests] all ${files.length} spec files passed in ${Date.now() - _RUN_STARTED_MS}ms`);
})().catch((err) => {
  clearInterval(_heartbeat);
  console.error(`[hme-tests] runner error: ${err && err.stack || err}`);
  process.exit(1);
});
