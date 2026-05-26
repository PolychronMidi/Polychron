'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const pluginUrl = `file://${path.resolve(__dirname, '../../opencode/plugin/hme_hooks.mjs')}`;

test('OpenCode plugin exports HME hook map for supported lifecycle events', async () => {
  const mod = await import(pluginUrl);
  const hooks = await mod.HmeHooks({ project: { directory: path.resolve(__dirname, '../../../..') } });
  assert.deepEqual(Object.keys(hooks).sort(), [
    'permission.ask',
    'session.compacted',
    'session.created',
    'tool.execute.after',
    'tool.execute.before',
  ]);
  for (const fn of Object.values(hooks)) assert.equal(typeof fn, 'function');
});

test('OpenCode plugin applyDecision denies HME-denied tool requests', async () => {
  const mod = await import(pluginUrl);
  assert.throws(
    () => mod.applyDecision({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'blocked by test' } }, { args: {} }),
    /blocked by test/,
  );
});

test('OpenCode plugin applyDecision patches mutable tool args', async () => {
  const mod = await import(pluginUrl);
  const output = { args: { file_path: 'old', keep: true } };
  mod.applyDecision({ decision: { behavior: 'modify', patch: { args: { file_path: 'new' } } } }, output);
  assert.deepEqual(output.args, { file_path: 'new', keep: true });
});
