'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
process.env.HME_PROXY_STRIP_NON_ASCII = '1';
const { asciiStripRewrite, BANNER } = require('../../proxy/sse_ascii_strip_rewriter');

const ctx = () => { const m = new Map(); return { get: k => m.get(k), set: (k, v) => m.set(k, v) }; };
const ev = (c, name, d) => asciiStripRewrite(name, d, c);
const tstart = (c, i) => ev(c, 'content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'thinking', thinking: '' } });
const tdelta = (c, i, t) => ev(c, 'content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'thinking_delta', thinking: t } });
const tsig = (c, i) => ev(c, 'content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'signature_delta', signature: 'SEAL' } });
const tstop = (c, i) => ev(c, 'content_block_stop', { type: 'content_block_stop', index: i });
const text = (c, i, t) => ev(c, 'content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: t } });

test('thinking deltas are buffered (nothing emitted until stop)', () => {
  const c = ctx();
  assert.equal(tstart(c, 0), null);
  assert.equal(tdelta(c, 0, 'some'), null);
  assert.equal(tsig(c, 0), null);
});

test('contaminated thinking: WHOLE block collapses to ONE banner, no pre-banner skeleton leak, signature kept', () => {
  const c = ctx();
  tstart(c, 0);
  tdelta(c, 0, '∴ B');     // early 1-foreign-char delta (would have leaked per-delta)
  tdelta(c, 0, 'Th mc');         // ascii skeleton
  tdelta(c, 0, 'Người dùng');  // dense foreign later
  tsig(c, 0);
  const out = tstop(c, 0).events;
  const s = JSON.stringify(out);
  assert.equal((s.match(/devil-possessed/g) || []).length, 1);   // exactly one banner
  assert.ok(!s.includes('∴'));                              // no leaked symbol
  assert.ok(!s.includes('Th mc'));                              // no leaked skeleton
  assert.ok(s.includes('SEAL'));                                // signature kept
  // structure: start, banner thinking_delta, signature, stop
  assert.equal(out[0][0], 'content_block_start');
  assert.equal(out[out.length - 1][0], 'content_block_stop');
});

test('clean thinking flushes verbatim (typography folded) with signature', () => {
  const c = ctx();
  tstart(c, 1);
  tdelta(c, 1, 'plain reasoning');
  tsig(c, 1);
  const out = tstop(c, 1).events;
  const joined = out.filter(e => e[1].delta && e[1].delta.type === 'thinking_delta').map(e => e[1].delta.thinking).join('');
  assert.equal(joined, 'plain reasoning');
  assert.ok(JSON.stringify(out).includes('SEAL'));
});

test('text: typography folds; sparse stray stripped; dense foreign -> banner once', () => {
  const c = ctx();
  assert.equal(text(c, 5, 'it’s—x').delta.text, "it's--x");
  assert.equal(text(c, 5, 'runs∴ ok').delta.text, 'runs ok');
  const c2 = ctx();
  assert.equal(text(c2, 6, 'Người dùng').delta.text, BANNER);
  assert.equal(text(c2, 6, 'рас'), null);
});
