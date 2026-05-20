'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hmeToolsForOmo, toOmoToolDescriptor } = require('../../omo_bridge/hme_tools_to_omo');

test('OMO tool bridge preserves metadata and marks mutating tools', () => {
  const desc = toOmoToolDescriptor({ name: 'Write', description: 'write file', args_schema: { type: 'object' }, metadata: { side_effect: 'write', approval: 'never', bridge_action: 'write' } });
  assert.equal(desc.name, 'Write');
  assert.equal(desc.input_schema.type, 'object');
  assert.equal(desc.metadata.side_effect, 'write');
  assert.equal(desc.metadata.mutating, true);
  assert.equal(desc.metadata.hme_policy_authority, true);
});

test('OMO tool bridge exports canonical HME tools without redefining schemas', () => {
  const tools = hmeToolsForOmo({ tools: [
    { name: 'Read', description: 'read', args_schema: { type: 'object' }, metadata: { side_effect: 'read', approval: 'never' } },
    { name: 'Bash', description: 'bash', args_schema: { type: 'object' }, metadata: { side_effect: 'shell', approval: 'destructive' } },
  ] });
  assert.equal(tools.length, 2);
  assert.equal(tools[0].metadata.mutating, false);
  assert.equal(tools[1].metadata.mutating, true);
});
