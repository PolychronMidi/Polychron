'use strict';

const assert = require('node:assert');
const test = require('node:test');

const middleware = require('../../proxy/middleware/04_compact_tool_descriptions');

function run(payload) {
  let dirty = false;
  middleware.onRequest({ payload, ctx: { markDirty: () => { dirty = true; } } });
  return dirty;
}

test('compact_tool_descriptions rewrites verbose tool descriptions only', () => {
  const payload = { tools: [
    { name: 'Read', description: 'very long read description' },
    { name: 'Agent', description: 'very long agent description' },
    { name: 'Bash', description: 'very long bash description' },
    { name: 'TodoWrite', description: 'very long todo description' },
    { name: 'WebFetch', description: 'very long fetch description' },
    { name: 'WebSearch', description: 'very long search description' },
    { name: 'Edit', description: 'keep me' },
  ] };
  assert.equal(run(payload), true);
  assert.match(payload.tools[0].description, /^Read a file by absolute path/);
  assert.match(payload.tools[1].description, /^Run a subagent/);
  assert.match(payload.tools[1].description, /Agent level=3 prompt=/);
  assert.match(payload.tools[2].description, /^Run a bash command/);
  assert.match(payload.tools[3].description, /^Maintain a session task list/);
  assert.match(payload.tools[4].description, /^Fetch and summarize a public URL/);
  assert.match(payload.tools[5].description, /^Search the web/);
  assert.equal(payload.tools[6].description, 'keep me');
  assert.deepEqual(Object.keys(payload.tools[1].input_schema.properties), ['description', 'prompt', 'subagent_type']);
  assert.deepEqual(payload.tools[1].input_schema.required, ['description', 'prompt']);
  assert.equal(payload.tools[1].input_schema.additionalProperties, false);
  assert.ok(payload.tools[0].description.length < 220);
  assert.ok(payload.tools[1].description.length < 360);
  assert.ok(payload.tools[2].description.length < 320);
  assert.ok(payload.tools[3].description.length < 320);
  assert.ok(payload.tools[4].description.length < 260);
  assert.ok(payload.tools[5].description.length < 220);
});

test('compact_tool_descriptions is no-op when tools are absent', () => {
  assert.equal(run({}), false);
});
