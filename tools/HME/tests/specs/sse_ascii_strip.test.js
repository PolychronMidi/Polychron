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

test('text: a lone stray char in short English never banners (the "precise" regression)', () => {
  // Single unmapped non-ASCII char in a short chunk: 1/8 > 10% would have
  // tripped the ratio gate and bannered the whole word. It must NOT.
  for (const stray of [' ', ' ', '⁠', '­']) {
    const out = text(mkCtx(), 1, 'prec' + stray + 'ise ');
    assert.notEqual(out && out.delta && out.delta.text, BANNER, JSON.stringify(stray));
    assert.ok(out.delta.text.includes('prec') && out.delta.text.includes('ise'), JSON.stringify(stray));
  }
});

test('text: common benign whitespace/punct fold to ASCII (not counted as foreign)', () => {
  assert.equal(text(mkCtx(), 1, 'a b').delta.text, 'a b');     // thin space
  assert.equal(text(mkCtx(), 1, 'a b').delta.text, 'a b');     // narrow nbsp
  assert.equal(text(mkCtx(), 1, 'a‒b').delta.text, 'a-b');     // figure dash
  assert.equal(text(mkCtx(), 1, 'a―b').delta.text, 'a--b');    // horizontal bar
  assert.equal(text(mkCtx(), 1, 'a•b').delta.text, 'a*b');     // bullet
  assert.equal(text(mkCtx(), 1, 'a­b').delta.text, 'ab');      // soft hyphen
  assert.equal(text(mkCtx(), 1, 'a⁠b').delta.text, 'ab');      // word joiner
});

test('text: two residual foreign letters in a short chunk still strip inline, not banner', () => {
  // n=2, below FOREIGN_ABS, must strip inline rather than nuke the chunk.
  const out = text(mkCtx(), 1, 'hi да there');
  assert.notEqual(out.delta.text, BANNER);
  assert.ok(out.delta.text.includes('hi') && out.delta.text.includes('there'));
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
