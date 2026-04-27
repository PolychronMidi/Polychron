'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const policy = require('../../policies/builtin/block-git-checkout-clobber.js');

function _ctx(cmd) {
  let denied = null;
  return {
    toolInput: { command: cmd },
    allow: () => ({ allowed: true }),
    deny: (reason) => { denied = reason; return { allowed: false, reason }; },
    _denied: () => denied,
  };
}

test('blocks git checkout HEAD~1 -- .', async () => {
  const c = _ctx('git checkout HEAD~1 -- .');
  const r = await policy.fn(c);
  assert.strictEqual(r.allowed, false);
});

test('blocks git checkout main -- .', async () => {
  const c = _ctx('git checkout main -- .');
  const r = await policy.fn(c);
  assert.strictEqual(r.allowed, false);
});

test('blocks git checkout abc1234 -- *', async () => {
  const c = _ctx('git checkout abc1234 -- *');
  const r = await policy.fn(c);
  assert.strictEqual(r.allowed, false);
});

test('blocks git stash && git checkout main', async () => {
  const c = _ctx('git stash && git checkout main');
  const r = await policy.fn(c);
  assert.strictEqual(r.allowed, false);
});

test('blocks git stash; git checkout HEAD~2', async () => {
  const c = _ctx('git stash; git checkout HEAD~2');
  const r = await policy.fn(c);
  assert.strictEqual(r.allowed, false);
});

test('allows git checkout <branch> (no -- .)', async () => {
  const c = _ctx('git checkout feature-branch');
  const r = await policy.fn(c);
  assert.strictEqual(r.allowed, true);
});

test('allows git checkout HEAD~1 -- specific/file.js', async () => {
  const c = _ctx('git checkout HEAD~1 -- specific/file.js');
  const r = await policy.fn(c);
  assert.strictEqual(r.allowed, true);
});

test('allows git show HEAD~1 -- .', async () => {
  const c = _ctx('git show HEAD~1 -- .');
  const r = await policy.fn(c);
  assert.strictEqual(r.allowed, true);
});

test('allows git worktree add /tmp/x HEAD~1', async () => {
  const c = _ctx('git worktree add /tmp/x HEAD~1');
  const r = await policy.fn(c);
  assert.strictEqual(r.allowed, true);
});
