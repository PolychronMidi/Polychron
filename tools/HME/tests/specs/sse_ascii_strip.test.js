'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
process.env.HME_PROXY_STRIP_NON_ASCII = '1';
const { asciiStripRewrite, BANNER } = require('../../proxy/sse_ascii_strip_rewriter');

const ctx = () => { const m = new Map(); return { get: k => m.get(k), set: (k, v) => m.set(k, v) }; };
const text = (c, i, t) => asciiStripRewrite('content_block_delta',
  { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: t } }, c);
const think = (c, i, t) => asciiStripRewrite('content_block_delta',
  { type: 'content_block_delta', index: i, delta: { type: 'thinking_delta', thinking: t } }, c);
const sig = (c, i) => asciiStripRewrite('content_block_delta',
  { type: 'content_block_delta', index: i, delta: { type: 'signature_delta', signature: 'SEAL' } }, c);

test('text: clean passthrough', () => { assert.equal(text(ctx(), 1, ' hi').delta.text, ' hi'); });
test('text: typography folds (no banner)', () => { assert.equal(text(ctx(), 1, 'it’s—x…').delta.text, "it's--x..."); });
test('text: sparse stray stripped inline', () => { assert.equal(text(ctx(), 1, 'runs∴ ok').delta.text, 'runs ok'); });
test('text: dense foreign -> banner once; later dropped', () => {
  const c = ctx();
  assert.equal(text(c, 1, 'Người dùng muốn').delta.text, BANNER);
  assert.equal(text(c, 1, 'еще'), null);
});
test('thinking: dense foreign -> banner, but signature is KEPT (block stays signed)', () => {
  const c = ctx();
  assert.equal(think(c, 0, 'Người dùng muốn').delta.thinking, BANNER);
  assert.equal(think(c, 0, 'rác'), null);          // later contaminated dropped
  assert.notEqual(sig(c, 0), null);                // signature passes through -> signed
});
test('thinking: clean passes verbatim with signature', () => {
  const c = ctx();
  assert.equal(think(c, 2, ' reasoning').delta.thinking, ' reasoning');
  assert.notEqual(sig(c, 2), null);
});
