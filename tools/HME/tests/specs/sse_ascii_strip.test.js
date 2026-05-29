'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

process.env.HME_PROXY_STRIP_NON_ASCII = '1';
const { asciiStripRewrite, BANNER } = require('../../proxy/sse_ascii_strip_rewriter');

function mkCtx() { const m = new Map(); return { get: (k) => m.get(k), set: (k, v) => m.set(k, v) }; }
function textDelta(ctx, idx, text) {
  return asciiStripRewrite('content_block_delta',
    { type: 'content_block_delta', index: idx, delta: { type: 'text_delta', text } }, ctx);
}
function thinkDelta(ctx, idx, thinking) {
  return asciiStripRewrite('content_block_delta',
    { type: 'content_block_delta', index: idx, delta: { type: 'thinking_delta', thinking } }, ctx);
}
function sigDelta(ctx, idx) {
  return asciiStripRewrite('content_block_delta',
    { type: 'content_block_delta', index: idx, delta: { type: 'signature_delta', signature: 'SEAL' } }, ctx);
}

test('clean ASCII passes through untouched', () => {
  assert.equal(textDelta(mkCtx(), 0, ' plain text').delta.text, ' plain text');
});

test('typography folds to ASCII (no banner)', () => {
  assert.equal(textDelta(mkCtx(), 0, 'it’s—fine…').delta.text, "it's--fine...");
});

test('stray non-ASCII symbol in English is stripped INLINE, never bannered mid-sentence', () => {
  assert.equal(textDelta(mkCtx(), 0, 'guard runs∴ every 30s').delta.text, 'guard runs every 30s');
});

test('dense foreign-script text gets the banner, not a mangled skeleton', () => {
  const r = textDelta(mkCtx(), 0, 'Người dùng muốn tôi');
  assert.equal(r.delta.text, BANNER);
});

test('banner fires once per block; later contaminated text deltas drop', () => {
  const ctx = mkCtx();
  assert.equal(textDelta(ctx, 0, 'Русский текст').delta.text, BANNER);
  assert.equal(textDelta(ctx, 0, 'еще спам'), null);
});

test('foreign thinking -> placeholder, and its signature is dropped (no seal mismatch)', () => {
  const ctx = mkCtx();
  assert.equal(thinkDelta(ctx, 0, 'Người dùng').delta.thinking, '.');
  assert.equal(thinkDelta(ctx, 0, 'thêm rác'), null);
  assert.equal(sigDelta(ctx, 0), null);              // seal dropped on redacted block
});

test('clean thinking + its signature pass through', () => {
  const ctx = mkCtx();
  assert.equal(thinkDelta(ctx, 2, ' plain reasoning').delta.thinking, ' plain reasoning');
  assert.notEqual(sigDelta(ctx, 2), null);           // seal kept on clean block
});

test('stateful /g regex does not leak across calls (lastIndex reset)', () => {
  const ctx = mkCtx();
  // two consecutive foreign thinking deltas must BOTH be handled
  assert.equal(thinkDelta(ctx, 0, 'Người').delta.thinking, '.');
  assert.equal(thinkDelta(ctx, 0, 'dùng'), null);   // not leaked through as raw
});
