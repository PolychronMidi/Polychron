'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { requireEnv } = require('../../proxy/shared/load_env');

// The live-live invariant this guards: EVERY file that feeds the runtime
// fingerprint ("wanted") must also be in the file-watcher's trigger set, or a
const { extraRuntimeFiles, EXTRA_RUNTIME_FILES } = require('../../proxy/proxy_runtime_fingerprint');
const watcher = require('../../proxy/shuffler/file_watcher');

const ROOT = requireEnv('PROJECT_ROOT');

test('shouldRestart() fires for every EXTRA fingerprint-input file (.env, launcher, supervisor)', () => {
  for (const abs of extraRuntimeFiles(ROOT)) {
    assert.equal(watcher.shouldRestart(abs), true, `watcher must rotate on change to ${abs}`);
  }
});

test('non-fingerprint shell scripts do NOT trigger restart (no over-broad rotation)', () => {
  const unrelated = path.join(ROOT, 'tools', 'HME', 'hooks', 'lifecycle', 'userpromptsubmit.sh');
  assert.equal(watcher.shouldRestart(unrelated), false);
});

test('the watch ENUMERATION set is a superset of the fingerprint EXTRA inputs', () => {
  const watched = new Set(watcher._enumerateAllWatchedFiles());
  for (const abs of extraRuntimeFiles(ROOT)) {
    assert.ok(watched.has(abs), `watch set is missing fingerprint input ${abs}`);
  }
});

test('proxy-tree .js still triggers restart (baseline unbroken)', () => {
  assert.equal(watcher.shouldRestart(path.join(ROOT, 'tools', 'HME', 'proxy', 'sse_slop_rewriter.js')), true);
});

test('shuffler-own files never self-trigger (avoids restart loop)', () => {
  assert.equal(watcher.shouldRestart(path.join(ROOT, 'tools', 'HME', 'proxy', 'shuffler', 'file_watcher.js')), false);
});

test('EXTRA_RUNTIME_FILES is non-empty and includes .env (regression: the gap source)', () => {
  assert.ok(EXTRA_RUNTIME_FILES.length >= 1);
  assert.ok(EXTRA_RUNTIME_FILES.includes('.env'));
});
