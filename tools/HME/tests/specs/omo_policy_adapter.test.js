'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyOmoAction, checkOmoAction, checkOmoActionThroughHme } = require('../../omo_bridge/policy_adapter');

test('OMO policy adapter classifies mutating action types', () => {
  assert.equal(classifyOmoAction({ tool: 'Write' }), 'write');
  assert.equal(classifyOmoAction({ command: 'echo hi' }), 'shell');
  assert.equal(classifyOmoAction({ tool: 'WebFetch' }), 'network');
  assert.equal(classifyOmoAction({ tool: 'Read' }), 'read');
});

test('OMO policy adapter blocks mutations unless routed through HME policy path', () => {
  const result = checkOmoAction({ tool: 'Write', input: { file_path: 'x' } });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /HME policy/);
});

test('OMO policy adapter allows read-only actions by default', () => {
  const result = checkOmoAction({ tool: 'Read', input: { file_path: 'x' } });
  assert.equal(result.allowed, true);
});

test('OMO policy adapter can route write actions through HME pre-write policy', async () => {
  const result = await checkOmoActionThroughHme({ tool: 'Edit', input: { file_path: '', old_string: '', new_string: 'x' } });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /malformed Edit/);
});
