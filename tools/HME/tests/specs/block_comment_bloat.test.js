'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const registry = require('../../policies/registry');
const policy = require('../../policies/builtin/block-comment-bloat');

function _ctx(overrides = {}) {
  return {
    toolInput: {},
    deny: registry.deny, instruct: registry.instruct, allow: registry.allow, rewrite: registry.rewrite,
    ...overrides,
  };
}

test('block-comment-bloat: rewrites 3+ consecutive comment lines to keep first 2', async () => {
  const content = 'const x = 1;\n// header line 1 of block\n// header line 2 of block\n// header line 3 of block\n// header line 4 of block\nconst y = 2;\n';
  const r = await policy.fn(_ctx({ toolInput: { file_path: 'a.js', new_string: content } }));
  assert.strictEqual(r.decision, 'rewrite');
  assert.match(r.message, /DDoC stripped: comment_bloat - lines removed/);
  const out = r.updatedInput.new_string;
  assert.match(out, /header line 1 of block/);
  assert.match(out, /header line 2 of block/);
  assert.doesNotMatch(out, /header line 3 of block/);
  assert.doesNotMatch(out, /header line 4 of block/);
});

test('block-comment-bloat: truncates comment line >= LONG_LINE chars', async () => {
  const longComment = '// ' + 'x'.repeat(120);
  const content = `const a = 1;\n${longComment}\nconst b = 2;\n`;
  const r = await policy.fn(_ctx({ toolInput: { file_path: 'a.js', content } }));
  assert.strictEqual(r.decision, 'rewrite');
  assert.match(r.message, /DDoC stripped: chars 90-/);
  const lines = r.updatedInput.content.split('\n');
  assert.ok(lines[1].length < 90, `truncated comment should be <90 chars, was ${lines[1].length}`);
});

test('block-comment-bloat: allows tight content with annotation comments', async () => {
  const content = 'const x = 1;\n// silent-ok: ignore\n// silent-ok: ignore\n// silent-ok: ignore\nconst y = 2;\n';
  const r = await policy.fn(_ctx({ toolInput: { file_path: 'a.js', content } }));
  assert.strictEqual(r.decision, 'allow');
});

test('block-comment-bloat: skips files with no known comment prefix', async () => {
  const r = await policy.fn(_ctx({ toolInput: { file_path: 'a.txt', content: 'whatever' } }));
  assert.strictEqual(r.decision, 'allow');
});
