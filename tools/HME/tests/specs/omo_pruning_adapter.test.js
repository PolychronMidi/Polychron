'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pruneWithOmo } = require('../../omo_bridge/pruning_adapter');

test('OMO pruning adapter compat mode removes duplicate messages', async () => {
  const payload = { messages: [{ role: 'user', content: 'a' }, { role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] };
  const out = await pruneWithOmo(payload, {});
  assert.equal(out.stats.duplicates_pruned, 1);
  assert.equal(out.payload.messages.length, 2);
  assert.equal(out.changed, true);
});

test('OMO pruning adapter delegates to OMO prune when provided', async () => {
  const payload = { messages: [{ role: 'user', content: 'a' }] };
  const out = await pruneWithOmo(payload, { omo: { prune: async () => ({ payload: { messages: [] }, duplicates_pruned: 0 }) } });
  assert.equal(out.payload.messages.length, 0);
});
