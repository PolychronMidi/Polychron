'use strict';

const assert = require('node:assert');
const test = require('node:test');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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
  assert.deepEqual(Object.keys(payload.tools[1].input_schema.properties), ['level', 'prompt']);
  assert.deepEqual(payload.tools[1].input_schema.required, ['level', 'prompt']);
  assert.equal(payload.tools[1].input_schema.additionalProperties, false);
  assert.ok(payload.tools[0].description.length < 220);
  assert.ok(payload.tools[1].description.length < 360);
  assert.ok(payload.tools[2].description.length < 320);
  assert.ok(payload.tools[3].description.length < 320);
  assert.ok(payload.tools[4].description.length < 260);
  assert.ok(payload.tools[5].description.length < 220);
});

test('compact_tool_descriptions inserts canonical TodoWrite when missing', () => {
  const payload = { tools: [
    { name: 'Read', description: 'very long read description' },
    { name: 'TaskCreate', description: 'task create should have been filtered earlier' },
  ] };
  assert.equal(run(payload), true);
  const names = payload.tools.map((t) => t.name);
  assert.deepEqual(names, ['Read', 'TaskCreate', 'TodoWrite']);
  const todo = payload.tools.find((t) => t.name === 'TodoWrite');
  assert.match(todo.description, /^Maintain a session task list/);
  assert.deepEqual(Object.keys(todo.input_schema.properties), ['todos']);
  assert.deepEqual(todo.input_schema.required, ['todos']);
});

test('filter_tools reads current .env drop list and strips task-tool surface', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-filter-tools-'));
  try {
    fs.writeFileSync(path.join(root, '.env'), 'HME_FILTER_TOOLS_DROP=TaskCreate,TaskGet,TaskList,TaskStop,TaskUpdate,TaskOutput # comment\n');
    const filter = require('../../proxy/middleware/03_filter_tools');
    const payload = { tools: [
      { name: 'Read' },
      { name: 'TaskCreate' },
      { name: 'TaskGet' },
      { name: 'TaskList' },
      { name: 'TaskStop' },
      { name: 'TaskUpdate' },
      { name: 'Write' },
    ] };
    let dirty = false;
    filter.onRequest({ payload, ctx: { PROJECT_ROOT: root, markDirty: () => { dirty = true; } } });
    assert.equal(dirty, true);
    assert.deepEqual(payload.tools.map((t) => t.name), ['Read', 'Write']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('compact_tool_descriptions is no-op when tools are absent', () => {
  assert.equal(run({}), false);
});
