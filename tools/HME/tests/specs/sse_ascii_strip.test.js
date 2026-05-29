'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

process.env.HME_PROXY_STRIP_NON_ASCII = '1';
const { asciiStripRewrite, BANNER } = require('../../proxy/sse_ascii_strip_rewriter');

function mkCtx() { const m = new Map(); return { get: (k) => m.get(k), set: (k, v) => m.set(k, v) }; }
const start = (ctx, i) => asciiStripRewrite('content_block_start',
  { type: 'content_block_start', index: i, content_block: { type: 'thinking', thinking: '' } }, ctx);
const think = (ctx, i, t) => asciiStripRewrite('content_block_delta',
  { type: 'content_block_delta', index: i, delta: { type: 'thinking_delta', thinking: t } }, ctx);
const sig = (ctx, i) => asciiStripRewrite('content_block_delta',
  { type: 'content_block_delta', index: i, delta: { type: 'signature_delta', signature: 'SEAL' } }, ctx);
const stop = (ctx, i) => asciiStripRewrite('content_block_stop', { type: 'content_block_stop', index: i }, ctx);
const text = (ctx, i, t) => asciiStripRewrite('content_block_delta',
  { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: t } }, ctx);

test('text: clean passes, typography folds, stray symbol stripped inline', () => {
  assert.equal(text(mkCtx(), 1, ' plain').delta.text, ' plain');
  assert.equal(text(mkCtx(), 1, 'it’s—fine…').delta.text, "it's--fine...");
  assert.equal(text(mkCtx(), 1, 'guard runs∴ ok').delta.text, 'guard runs ok');
});

test('text: dense foreign script -> banner once per block', () => {
  const ctx = mkCtx();
  assert.equal(text(ctx, 1, 'Người dùng muốn').delta.text, BANNER);
  assert.equal(text(ctx, 1, 'еще'), null);
});

test('thinking: clean block flushes verbatim with signature, typography folded', () => {
  const ctx = mkCtx();
  assert.equal(start(ctx, 0), null);
  assert.equal(think(ctx, 0, 'reasoning—ok'), null);
  assert.equal(sig(ctx, 0), null);
  const out = stop(ctx, 0).events;
  assert.equal(out[0][0], 'content_block_start');
  assert.equal(out[1][1].delta.thinking, 'reasoning--ok');
  assert.equal(out[2][1].delta.type, 'signature_delta');
  assert.equal(out[3][0], 'content_block_stop');
});

test('thinking: ANY contaminated delta collapses the WHOLE block to one banner, signature dropped', () => {
  const ctx = mkCtx();
  start(ctx, 0);
  think(ctx, 0, '∴ .jstrong th mc');   // marker + mangled ascii
  think(ctx, 0, 'Th. B V');            // pure-ascii garbage in same span
  sig(ctx, 0);
  const out = stop(ctx, 0).events;
  assert.equal(out.length, 3);                                   // start, banner, stop
  assert.equal(out[0][0], 'content_block_start');
  assert.equal(out[1][1].delta.thinking, BANNER);
  assert.equal(out[2][0], 'content_block_stop');
  assert.ok(!JSON.stringify(out).includes('SEAL'));              // signature dropped
  assert.ok(!JSON.stringify(out).includes('jstrong'));           // mangled ascii gone too
});

test('block indices preserved (no shift) so client block table stays in sync', () => {
  const ctx = mkCtx();
  start(ctx, 2); think(ctx, 2, 'спам'); 
  assert.equal(stop(ctx, 2).events[0][1].index, 2);
});
