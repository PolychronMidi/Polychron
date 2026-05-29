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

// Source stays ASCII-clean (no-non-ascii lint): every non-ASCII char via \u escape.
const EM_DASH = '—';
const RSQUO = '’';
const HELLIP = '…';
const THEREFORE = '∴';
const THIN_SPACE = ' ';
const NARROW_NBSP = ' ';
const FIGURE_DASH = '‒';
const HORIZONTAL_BAR = '―';
const BULLET = '•';
const SOFT_HYPHEN = '­';
const WORD_JOINER = '⁠';
const VN = 'Người dùng muốn';   // Vietnamese
const CYR_ESHCHE = 'еще';            // Cyrillic
const CYR_DA = 'да';                       // Cyrillic "da"

test('text: clean passes, typography folds, stray symbol stripped inline', () => {
  assert.equal(text(mkCtx(), 1, ' plain').delta.text, ' plain');
  assert.equal(text(mkCtx(), 1, 'it' + RSQUO + 's' + EM_DASH + 'fine' + HELLIP).delta.text, "it's--fine...");
  assert.equal(text(mkCtx(), 1, 'guard runs' + THEREFORE + ' ok').delta.text, 'guard runs ok');
});

test('text: dense foreign script -> banner once per block', () => {
  const ctx = mkCtx();
  assert.equal(text(ctx, 1, VN).delta.text, BANNER);
  assert.equal(text(ctx, 1, CYR_ESHCHE), null);
});

test('text: a lone stray char in short English never banners (the "precise" regression)', () => {
  // Single unmapped non-ASCII char in a short chunk: 1/8 > 10% would have
  // tripped the ratio gate and bannered the whole word. It must NOT.
  for (const stray of [THIN_SPACE, NARROW_NBSP, WORD_JOINER, SOFT_HYPHEN]) {
    const out = text(mkCtx(), 1, 'prec' + stray + 'ise ');
    assert.notEqual(out && out.delta && out.delta.text, BANNER, JSON.stringify(stray));
    assert.ok(out.delta.text.includes('prec') && out.delta.text.includes('ise'), JSON.stringify(stray));
  }
});

test('text: common benign whitespace/punct fold to ASCII (not counted as foreign)', () => {
  assert.equal(text(mkCtx(), 1, 'a' + THIN_SPACE + 'b').delta.text, 'a b');
  assert.equal(text(mkCtx(), 1, 'a' + NARROW_NBSP + 'b').delta.text, 'a b');
  assert.equal(text(mkCtx(), 1, 'a' + FIGURE_DASH + 'b').delta.text, 'a-b');
  assert.equal(text(mkCtx(), 1, 'a' + HORIZONTAL_BAR + 'b').delta.text, 'a--b');
  assert.equal(text(mkCtx(), 1, 'a' + BULLET + 'b').delta.text, 'a*b');
  assert.equal(text(mkCtx(), 1, 'a' + SOFT_HYPHEN + 'b').delta.text, 'ab');
  assert.equal(text(mkCtx(), 1, 'a' + WORD_JOINER + 'b').delta.text, 'ab');
});

test('text: two residual foreign letters in a short chunk still strip inline, not banner', () => {
  // n=2, below FOREIGN_ABS, must strip inline rather than nuke the chunk.
  const out = text(mkCtx(), 1, 'hi ' + CYR_DA + ' there');
  assert.notEqual(out.delta.text, BANNER);
  assert.ok(out.delta.text.includes('hi') && out.delta.text.includes('there'));
});

test('thinking: clean block flushes verbatim with signature, typography folded', () => {
  const ctx = mkCtx();
  assert.equal(start(ctx, 0), null);
  assert.equal(think(ctx, 0, 'reasoning' + EM_DASH + 'ok'), null);
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
  think(ctx, 0, THEREFORE + ' .jstrong th mc');   // marker + mangled ascii
  think(ctx, 0, 'Th. B V');                        // pure-ascii garbage in same span
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
  start(ctx, 2); think(ctx, 2, 'спам');  // Cyrillic "spam"
  assert.equal(stop(ctx, 2).events[0][1].index, 2);
});
