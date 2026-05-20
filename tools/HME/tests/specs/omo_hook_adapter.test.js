'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { invokeOmoHook, validateHookResult } = require('../../omo_bridge/hook_adapter');
const { createOpenCodeHost } = require('../../omo_bridge/opencode_host');
const { HOOK_MAP } = require('../../omo_bridge/lifecycle_map');

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

test('OMO hook adapter supports OpenCode two-argument mutation hooks', async () => {
  const out = await invokeOmoHook('chat.params', { sessionID: 's1' }, { enabled: true, hooks: { 'chat.params': async (_input, output) => { output.temperature = 0.2; } } });
  assert.equal(out.result, 'applied');
  assert.equal(out.output.temperature, 0.2);
});

test('OpenCode host shim maps lifecycle to plugin hooks', async () => {
  const host = await createOpenCodeHost({ 'chat.params': async (input, output) => { output.note = input.metadata.hme_event; } }, { enabled: true });
  const results = await host.invoke('chat.params', { event: 'request', session_id: 's1' }, { enabled: true });
  assert.equal(results[0].result, 'applied');
  assert.equal(results[0].output.note, 'request');
});
