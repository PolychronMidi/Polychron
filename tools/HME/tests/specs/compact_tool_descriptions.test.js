'use strict';

const assert = require('node:assert');
const test = require('node:test');

const middleware = require('../../proxy/middleware/04_compact_tool_descriptions');

function run(payload) {
  let dirty = false;
  middleware.onRequest({ payload, ctx: { markDirty: () => { dirty = true; } } });
  return dirty;
}

test('compact_tool_descriptions rewrites Read, Agent, and Bash descriptions only', () => {
  const payload = { tools: [
    { name: 'Read', description: 'very long read description' },
    { name: 'Agent', description: 'very long agent description' },
    { name: 'Bash', description: 'very long bash description' },
    { name: 'Edit', description: 'keep me' },
  ] };
  assert.equal(run(payload), true);
  assert.match(payload.tools[0].description, /^Read a file by absolute path/);
  assert.match(payload.tools[1].description, /^Launch a subagent or fork/);
  assert.match(payload.tools[2].description, /^Run a bash command/);
  assert.equal(payload.tools[3].description, 'keep me');
  assert.ok(payload.tools[0].description.length < 220);
  assert.ok(payload.tools[1].description.length < 360);
  assert.ok(payload.tools[2].description.length < 320);
});

test('compact_tool_descriptions is no-op when tools are absent', () => {
  assert.equal(run({}), false);
});
