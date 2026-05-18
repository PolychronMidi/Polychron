'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

function runOnContent(content) {
  const policy = require('../../proxy/middleware/00_strip_skill_reminder');
  let dirty = false;
  policy.onRequest({
    payload: { messages: [{ role: 'user', content }] },
    ctx: { markDirty: () => { dirty = true; }, emit: () => {} },
  });
  return { content, dirty };
}

function runOnText(text) {
  const block = { type: 'text', text };
  const out = runOnContent([block]);
  return { text: block.text, dirty: out.dirty };
}

test('stop-hook compaction preserves auto-completeness discriminator', () => {
  const input = 'Stop hook feedback:\n[node /x/event_kernel/claude_adapter.js Stop]: AUTO-COMPLETENESS CHECK (round 1/2): long payload';
  const out = runOnText(input);
  assert.strictEqual(out.dirty, true);
  assert.match(out.text, /AUTO-COMPLETENESS CHECK/);
  assert.match(out.text, /compacted by hme-proxy/);
});

test('stop-hook compaction preserves exhaust discriminator', () => {
  const input = 'Stop hook feedback:\n[node /x/event_kernel/claude_adapter.js Stop]: EXHAUST PROTOCOL VIOLATION: long payload';
  const out = runOnText(input);
  assert.strictEqual(out.dirty, true);
  assert.match(out.text, /EXHAUST PROTOCOL VIOLATION/);
  assert.match(out.text, /compacted by hme-proxy/);
});

test('existing compacted stop-hook sentinel is stripped', () => {
  const input = 'Stop hook feedback: repeated auto-completeness/exhaust gate compacted by hme-proxy.';
  const policy = require('../../proxy/middleware/00_strip_skill_reminder');
  const content = [{ type: 'text', text: input }];
  let dirty = false;
  policy.onRequest({
    payload: { messages: [{ role: 'user', content }] },
    ctx: { markDirty: () => { dirty = true; }, emit: () => {} },
  });
  assert.strictEqual(dirty, true);
  assert.deepStrictEqual(content, []);
});
