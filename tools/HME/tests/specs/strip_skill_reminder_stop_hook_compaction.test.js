'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

function runOnText(text) {
  const policy = require('../../proxy/middleware/00_strip_skill_reminder');
  const block = { type: 'text', text };
  let dirty = false;
  policy.onRequest({
    payload: { messages: [{ role: 'user', content: [block] }] },
    ctx: { markDirty: () => { dirty = true; }, emit: () => {} },
  });
  return { text: block.text, dirty };
}

test('stop-hook compaction preserves auto-completeness discriminator', () => {
  const input = 'Stop hook feedback:\n[bash /x/_proxy_bridge.sh Stop]: AUTO-COMPLETENESS CHECK (round 1/2): long payload';
  const out = runOnText(input);
  assert.strictEqual(out.dirty, true);
  assert.match(out.text, /AUTO-COMPLETENESS CHECK/);
  assert.match(out.text, /compacted by hme-proxy/);
});

test('stop-hook compaction preserves exhaust discriminator', () => {
  const input = 'Stop hook feedback:\n[bash /x/_proxy_bridge.sh Stop]: EXHAUST PROTOCOL VIOLATION: long payload';
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
