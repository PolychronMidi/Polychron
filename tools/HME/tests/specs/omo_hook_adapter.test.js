'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { invokeOmoHook, validateHookResult } = require('../../omo_bridge/hook_adapter');
const { createOpenCodeHost } = require('../../omo_bridge/opencode_host');

test('OMO hook adapter blocks mutating hook output by default', () => {
  const result = validateHookResult({ messages: [] });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /blocked/);
});

test('OMO hook adapter returns noop when disabled', async () => {
  const out = await invokeOmoHook('chat.message', {}, { enabled: false, hooks: { 'chat.message': async () => ({}) } });
  assert.equal(out.result, 'noop');
});

test('OMO hook adapter invokes hook and validates allowed pure output', async () => {
  const out = await invokeOmoHook('event', { phase: 'test' }, { enabled: true, hooks: { event: async () => ({ note: 'ok' }) } });
  assert.equal(out.result, 'applied');
  assert.deepEqual(out.output, { note: 'ok' });
});

test('OpenCode host shim maps lifecycle to plugin hooks', async () => {
  const host = await createOpenCodeHost({ 'chat.params': async (input) => ({ note: input.metadata.hme_event }) }, { enabled: true });
  const results = await host.invoke('chat.params', { event: 'request', session_id: 's1' }, { enabled: true });
  assert.equal(results[0].result, 'applied');
  assert.deepEqual(results[0].output, { note: 'request' });
});
