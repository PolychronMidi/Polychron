'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

function freshConfig() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes('/tools/HME/proxy/hme_config.js')) delete require.cache[key];
  }
  return require('../../proxy/hme_config');
}

test('load() returns a deep-frozen config snapshot', () => {
  const mod = freshConfig();
  const cfg = mod.load();
  assert.equal(Object.isFrozen(cfg), true);
  assert.equal(Object.isFrozen(cfg.proxy), true);
  assert.equal(Object.isFrozen(cfg.paths), true);
  assert.throws(() => { cfg.proxy.port = 9999; }, /Cannot assign/);
});

test('load() caches the same object across calls', () => {
  const mod = freshConfig();
  const a = mod.load();
  const b = mod.load();
  assert.equal(a, b);
});

test('reset() forces re-load on next call', () => {
  const mod = freshConfig();
  const a = mod.load();
  mod.reset();
  const b = mod.load();
  assert.notEqual(a, b);
  assert.deepEqual(a, b);
});

test('config exposes structured proxy + paths + optional sections', () => {
  const mod = freshConfig();
  const cfg = mod.load();
  assert.equal(typeof cfg.projectRoot, 'string');
  assert.equal(typeof cfg.proxy.port, 'number');
  assert.equal(typeof cfg.paths.runtime, 'string');
  assert.equal(typeof cfg.optional.opencodeApiKey, 'string');
  assert.ok(path.isAbsolute(cfg.projectRoot));
});
