'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { withChainSandbox, withChainSandboxAsync, makeSandbox } = require('../chain_sandbox');

test('makeSandbox creates expected directory tree with linked tools', () => {
  const root = makeSandbox('chain-sandbox-make-');
  try {
    assert.ok(fs.existsSync(path.join(root, 'src')));
    assert.ok(fs.existsSync(path.join(root, 'tmp')));
    assert.ok(fs.existsSync(path.join(root, 'log')));
    assert.ok(fs.existsSync(path.join(root, '.git')));
    assert.ok(fs.statSync(path.join(root, 'tools')).isDirectory());
    assert.ok(fs.statSync(path.join(root, 'bin/git')).mode & 0o111);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('withChainSandbox sets PROJECT_ROOT and HME_RUNTIME_DIR for callback', () => {
  const prior = process.env.PROJECT_ROOT;
  const seen = withChainSandbox('chain-sandbox-env-', (root) => {
    return {
      projectRoot: process.env.PROJECT_ROOT,
      runtimeDir: process.env.HME_RUNTIME_DIR,
      root,
    };
  });
  assert.equal(seen.projectRoot, seen.root);
  assert.equal(seen.runtimeDir, path.join(seen.root, 'tmp', 'hme-runtime'));
  assert.equal(process.env.PROJECT_ROOT, prior);
});

test('withChainSandbox restores env on throw and removes tmp dir', () => {
  const prior = process.env.PROJECT_ROOT;
  let capturedRoot = null;
  assert.throws(() => withChainSandbox('chain-sandbox-throw-', (root) => {
    capturedRoot = root;
    throw new Error('boom');
  }), /boom/);
  assert.equal(process.env.PROJECT_ROOT, prior);
  assert.equal(fs.existsSync(capturedRoot), false);
});

test('withChainSandboxAsync awaits the callback and restores env', async () => {
  const prior = process.env.PROJECT_ROOT;
  const seen = await withChainSandboxAsync('chain-sandbox-async-', async (root) => {
    await new Promise((resolve) => setImmediate(resolve));
    return { projectRoot: process.env.PROJECT_ROOT, root };
  });
  assert.equal(seen.projectRoot, seen.root);
  assert.equal(process.env.PROJECT_ROOT, prior);
});
