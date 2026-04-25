'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const stopChain = require('../../proxy/stop_chain');

test('stop_chain: exports the decision contract', () => {
  assert.strictEqual(typeof stopChain.runStopChain, 'function');
  assert.strictEqual(typeof stopChain.deny, 'function');
  assert.strictEqual(typeof stopChain.instruct, 'function');
  assert.strictEqual(typeof stopChain.allow, 'function');
});

test('stop_chain: deny shape', () => {
  assert.deepStrictEqual(stopChain.deny('reason text'), { decision: 'deny', reason: 'reason text' });
});

test('stop_chain: allow with optional message', () => {
  assert.deepStrictEqual(stopChain.allow(), { decision: 'allow', message: null });
  assert.deepStrictEqual(stopChain.allow('hi'), { decision: 'allow', message: 'hi' });
});

test('stop_chain: instruct shape', () => {
  assert.deepStrictEqual(stopChain.instruct('continue'), { decision: 'instruct', message: 'continue' });
});

test('stop_chain: runStopChain with empty payload returns shape {stdout, stderr, exit_code}', async () => {
  const result = await stopChain.runStopChain('{}');
  assert.strictEqual(typeof result, 'object');
  assert.strictEqual(typeof result.stdout, 'string');
  assert.strictEqual(typeof result.stderr, 'string');
  assert.strictEqual(typeof result.exit_code, 'number');
  assert.strictEqual(result.exit_code, 0, 'exit_code is always 0 — chain crashes do not wedge agent');
});

test('stop_chain: runStopChain handles malformed JSON without throwing', async () => {
  const result = await stopChain.runStopChain('not valid json');
  assert.strictEqual(result.exit_code, 0);
  assert.strictEqual(typeof result.stdout, 'string');
});
