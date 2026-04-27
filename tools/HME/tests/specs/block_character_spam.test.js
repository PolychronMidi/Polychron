'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const registry = require('../../policies/registry');
const policy = require('../../policies/builtin/block-character-spam');

// Build spam fixtures at runtime so this source file does not itself match
// the policy it tests. Same trick used by block-comment-ellipsis-stub.
const _eq = (n) => '='.repeat(n);
const _dash = (n) => '-'.repeat(n);
const _hash = (n) => '#'.repeat(n);
const _box = (n) => '─'.repeat(n);

function _ctx(overrides = {}) {
  return {
    toolInput: {},
    deny: registry.deny, instruct: registry.instruct, allow: registry.allow,
    ...overrides,
  };
}

test('block-character-spam: deny on equals-decoration in Write content', async () => {
  const r = await policy.fn(_ctx({
    toolInput: { content: 'hello\n// ' + _eq(5) + '\nworld' },
  }));
  assert.strictEqual(r.decision, 'deny');
  assert.match(r.reason, /4\+ identical decoration/);
});

test('block-character-spam: deny on dash-divider', async () => {
  const r = await policy.fn(_ctx({
    toolInput: { content: 'a\nb' + _dash(5) + 'c\n' },
  }));
  assert.strictEqual(r.decision, 'deny');
});

test('block-character-spam: deny on unicode box-drawing run', async () => {
  const r = await policy.fn(_ctx({
    toolInput: { content: '// ' + _box(8) + '\n' },
  }));
  assert.strictEqual(r.decision, 'deny');
});

test('block-character-spam: deny on markdown depth-4 heading (4 hashes)', async () => {
  const r = await policy.fn(_ctx({
    toolInput: { content: _hash(4) + ' Section\n' },
  }));
  assert.strictEqual(r.decision, 'deny');
});

test('block-character-spam: allow stacked closing parens (code structure)', async () => {
  const r = await policy.fn(_ctx({
    toolInput: { content: 'm.max(1, m.min(2, m.round(x)))))' },
  }));
  assert.strictEqual(r.decision, 'allow');
});

test('block-character-spam: allow underscore identifier', async () => {
  const r = await policy.fn(_ctx({
    toolInput: { content: 'def __init_private__(self): pass' },
  }));
  assert.strictEqual(r.decision, 'allow');
});

test('block-character-spam: allow hex constant 0xFFFFFFFF', async () => {
  const r = await policy.fn(_ctx({
    toolInput: { content: 'const MASK = 0xFFFFFFFF;' },
  }));
  assert.strictEqual(r.decision, 'allow');
});

test('block-character-spam: per-line opt-out via spam-ok marker', async () => {
  const r = await policy.fn(_ctx({
    toolInput: { content: 'discusses ' + _eq(6) + ' markers // spam-ok\n' },
  }));
  assert.strictEqual(r.decision, 'allow');
});

test('block-character-spam: deny on Edit new_string', async () => {
  const r = await policy.fn(_ctx({
    toolInput: { new_string: '// ' + _eq(4) + '\n' },
  }));
  assert.strictEqual(r.decision, 'deny');
});

test('block-character-spam: deny on MultiEdit edits[]', async () => {
  const r = await policy.fn(_ctx({
    toolInput: { edits: [{ new_string: 'ok' }, { new_string: '// ' + _dash(4) }] },
  }));
  assert.strictEqual(r.decision, 'deny');
});

test('block-character-spam: allow empty content', async () => {
  const r = await policy.fn(_ctx({ toolInput: {} }));
  assert.strictEqual(r.decision, 'allow');
});

test('block-character-spam: registry registers policy with correct match', () => {
  registry.loadBuiltins();
  const found = registry.list().find((p) => p.name === 'block-character-spam');
  assert.ok(found, 'policy should be registered');
  assert.deepStrictEqual(found.match.events, ['PreToolUse']);
  assert.deepStrictEqual(
    found.match.tools.slice().sort(),
    ['Edit', 'MultiEdit', 'Write'],
  );
});
