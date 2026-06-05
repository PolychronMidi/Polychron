'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const registry = require('../../policies/registry');
const policy = require('../../policies/builtin/block-comment-ellipsis-stub');

function _ctx(overrides = {}) {
  return {
    toolInput: {},
    deny: registry.deny, instruct: registry.instruct, allow: registry.allow, rewrite: registry.rewrite,
    ...overrides,
  };
}

const _STUB = '// ... ' + ['re' + 'st of', 'c' + 'ode'].join(' ');

test('block-comment-ellipsis-stub: rewrites Write content with stub placeholder', async () => {
  const content = `const a = 1;\n${_STUB}\nconst b = 2;\n`;
  const r = await policy.fn(_ctx({ toolInput: { content } }));
  assert.strictEqual(r.decision, 'rewrite');
  assert.equal(r.updatedInput.content, 'const a = 1;\nconst b = 2;\n');
  assert.match(r.message, /DDoC stripped: ellipsis stub - lines \[2\]/);
});

test('block-comment-ellipsis-stub: allows clean content', async () => {
  const r = await policy.fn(_ctx({ toolInput: { content: 'const x = 1;\nconst y = 2;\n' } }));
  assert.strictEqual(r.decision, 'allow');
});

test('block-comment-ellipsis-stub: allows empty content', async () => {
  const r = await policy.fn(_ctx({ toolInput: {} }));
  assert.strictEqual(r.decision, 'allow');
});
