'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const registry = require('../../policies/registry');
const policy = require('../../policies/builtin/auto-fill-agent-description');

function _ctx(overrides = {}) {
  return {
    toolInput: {},
    deny: registry.deny, instruct: registry.instruct, allow: registry.allow, rewrite: registry.rewrite,
    ...overrides,
  };
}

test('auto-fill-agent-description: rewrites Agent call missing description', async () => {
  const r = await policy.fn(_ctx({ toolInput: { level: 3, prompt: 'Audit parser edge cases in the lexer' } }));
  assert.strictEqual(r.decision, 'rewrite');
  assert.equal(r.updatedInput.description, 'Audit parser edge cases in the lexer');
  assert.equal(r.updatedInput.level, 3);
  assert.equal(r.updatedInput.prompt, 'Audit parser edge cases in the lexer');
  assert.match(r.message, /auto-filled Agent.description=/);
});

test('auto-fill-agent-description: truncates long prompt to ~60 chars', async () => {
  const longPrompt = 'A '.repeat(100);
  const r = await policy.fn(_ctx({ toolInput: { level: 4, prompt: longPrompt } }));
  assert.strictEqual(r.decision, 'rewrite');
  assert.ok(r.updatedInput.description.length <= 60);
  assert.match(r.updatedInput.description, /\.\.\.$/);
});

test('auto-fill-agent-description: uses first line only', async () => {
  const r = await policy.fn(_ctx({ toolInput: { level: 2, prompt: 'First line summary\nLine 2 detail\nLine 3 more' } }));
  assert.strictEqual(r.decision, 'rewrite');
  assert.equal(r.updatedInput.description, 'First line summary');
});

test('auto-fill-agent-description: allows when description already present', async () => {
  const r = await policy.fn(_ctx({ toolInput: { level: 1, prompt: 'go', description: 'do the thing' } }));
  assert.strictEqual(r.decision, 'allow');
});

test('auto-fill-agent-description: handles empty prompt with fallback', async () => {
  const r = await policy.fn(_ctx({ toolInput: { level: 3, prompt: '' } }));
  assert.strictEqual(r.decision, 'rewrite');
  assert.equal(r.updatedInput.description, 'Subagent task');
});

test('auto-fill-agent-description: registry registers policy for Agent and Task', () => {
  registry.loadBuiltins();
  const found = registry.list().find((p) => p.name === 'auto-fill-agent-description');
  assert.ok(found, 'policy should be registered');
  assert.deepStrictEqual(found.match.events, ['PreToolUse']);
  assert.deepStrictEqual(found.match.tools.slice().sort(), ['Agent', 'Task']);
});
