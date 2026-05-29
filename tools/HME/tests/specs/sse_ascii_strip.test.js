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
test('text: typography folds', () => { assert.equal(text(ctx(), 1, 'it’s—x…').delta.text, "it's--x..."); });
test('text: sparse stray non-ASCII stripped inline (no banner mid-sentence)', () => {
  assert.equal(text(ctx(), 1, 'guard runs∴ ok').delta.text, 'guard runs ok');
});
test('text: dense foreign -> banner once, later contaminated text dropped', () => {
  const c = ctx();
  assert.equal(text(c, 1, 'Người dùng muốn').delta.text, BANNER);
  assert.equal(text(c, 1, 'еще'), null);
});
test('thinking: passes verbatim, NEVER altered (signature stays valid)', () => {
  const c = ctx();
  assert.equal(think(c, 0, 'Người dùng').delta.thinking, 'Người dùng'); // untouched
  assert.notEqual(sig(c, 0), null);                                      // signature kept
});
