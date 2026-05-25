#!/usr/bin/env node
'use strict';
/**
 * HME unit-test runner. Spawns `node --test` against every spec file using
 * the platform's per-file process isolation so order-dependent global / env /
 * require-cache pollution between specs cannot turn a green focused lane red
 * here. Same-process require'ing of every spec hid real failures and produced
 * false ones; the platform runner is the right primitive for what this script
 * was originally trying to do.
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

const TESTS_DIR = path.join(__dirname, 'specs');
const files = fs.readdirSync(TESTS_DIR)
  .filter((f) => f.endsWith('.test.js'))
  .map((f) => path.join('tools', 'HME', 'tests', 'specs', f))
  .sort();

if (files.length === 0) {
  console.error('[hme-tests] no *.test.js files in specs/');
  process.exit(1);
}

const HEARTBEAT_MS = 30_000;
const RUN_STARTED_MS = Date.now();
const heartbeat = setInterval(() => {
  console.error(`[hme-tests] still running after ${Date.now() - RUN_STARTED_MS}ms`);
}, HEARTBEAT_MS);
heartbeat.unref();

const child = spawn(process.execPath, ['--test', ...files], {
  cwd: process.env.PROJECT_ROOT,
  env: process.env,
  stdio: ['ignore', 'inherit', 'inherit'],
});

child.on('exit', (code, signal) => {
  clearInterval(heartbeat);
  if (signal) {
    console.error(`[hme-tests] node --test killed by signal ${signal}`);
    process.exit(1);
  }
  process.exit(code || 0);
});

child.on('error', (err) => {
  clearInterval(heartbeat);
  console.error(`[hme-tests] failed to spawn node --test: ${err.message}`);
  process.exit(1);
});
