'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  STOP_HOOK_REWRITERS,
  STRATEGY_LOG_FILES,
  ackStripRewrite,
  fpGateMarkerRewrite,
  hallucinatedTurnPrefixStripRewrite,
  hookUiEchoStripRewrite,
  rewriteStopHookText,
  soloRationaleTrimRewrite,
  stopHookCeremonyStripRewrite,
  stopHookRewritersForSlot,
} = require('../../proxy/sse_stop_hook_rewriters');

const EXPECTED_STOP_HOOK_REWRITERS = Object.freeze([
  ['hook-ui-echo-strip', 'pre-tool'],
  ['fp-gate-marker', 'pre-tool'],
  ['stop-hook-ceremony-strip', 'pre-tool'],
  ['hallucinated-turn-prefix-strip', 'pre-tool'],
  ['bare-ack-strip', 'post-tool-pre-slop'],
  ['solo-rationale-trim', 'post-slop'],
]);

test('stop-hook rewriter registry keeps explicit ordering and slots', () => {
  assert.deepEqual(STOP_HOOK_REWRITERS.map((r) => [r.name, r.slot]), EXPECTED_STOP_HOOK_REWRITERS);
  assert.equal(STOP_HOOK_REWRITERS.find((r) => r.name === 'bare-ack-strip').logFile, 'hme-bare-ack-strips.jsonl');
});

test('stop-hook rewriter strategies expose required metadata', () => {
  for (const rewriter of STOP_HOOK_REWRITERS) {
    assert.equal(typeof rewriter.name, 'string');
    assert.ok(rewriter.name.length > 0);
    assert.equal(typeof rewriter.slot, 'string');
    assert.ok(rewriter.slot.length > 0);
    assert.equal(typeof rewriter.rewrite, 'function', `${rewriter.name} must expose stream rewrite()`);
    assert.equal(typeof rewriter.rewriteText, 'function', `${rewriter.name} must expose text rewrite()`);
    assert.ok(Object.prototype.hasOwnProperty.call(rewriter, 'logFile'), `${rewriter.name} must declare logFile metadata`);
    if (STRATEGY_LOG_FILES[rewriter.name]) {
      assert.equal(rewriter.logFile, STRATEGY_LOG_FILES[rewriter.name]);
    }
  }
});

test('stopHookRewritersForSlot returns stream functions in registry order', () => {
  assert.deepEqual(stopHookRewritersForSlot('pre-tool'), [
    hookUiEchoStripRewrite,
    fpGateMarkerRewrite,
    stopHookCeremonyStripRewrite,
    hallucinatedTurnPrefixStripRewrite,
  ]);
  assert.deepEqual(stopHookRewritersForSlot('post-tool-pre-slop'), [ackStripRewrite]);
  assert.deepEqual(stopHookRewritersForSlot('post-slop'), [soloRationaleTrimRewrite]);
});

test('rewriteStopHookText strips deny-cascade bare acknowledgements', () => {
  const ctx = new Map([['priorUserWasDeny', true]]);
  assert.equal(rewriteStopHookText('K.', ctx), '');
  assert.deepEqual(ctx.get('stop_hook_text_rewrites').map((r) => r.name), ['bare-ack-strip']);
});

test('rewriteStopHookText writes uniform strategy log records', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-rewriter-log-'));
  try {
    const ctx = new Map([['priorUserWasDeny', true], ['projectRoot', root]]);
    assert.equal(rewriteStopHookText('K.', ctx), '');
    const log = path.join(root, 'log', 'hme-bare-ack-strips.jsonl');
    const row = JSON.parse(fs.readFileSync(log, 'utf8').trim());
    assert.equal(row.strategy, 'bare-ack-strip');
    assert.equal(row.path, 'text');
    assert.equal(row.context, 'cascade-after-deny');
    assert.equal(row.text_preview, 'K.');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rewriteStopHookText strips FP no marker and preserves substantive work text', () => {
  const ctx = new Map([['priorUserWasDeny', true]]);
  const out = rewriteStopHookText('[FP-CHECK: no]\nRun verification now.', ctx);
  assert.equal(out, 'Run verification now.');
  assert.deepEqual(ctx.get('stop_hook_text_rewrites').map((r) => r.name), ['fp-gate-marker']);
});

test('rewriteStopHookText trims trailing solo-rationale ceremony', () => {
  const ctx = new Map([['priorUserWasDeny', true]]);
  const out = rewriteStopHookText('Fixed the route.\n\nSolo rationale: local patch only.', ctx);
  assert.equal(out, 'Fixed the route.');
  assert.deepEqual(ctx.get('stop_hook_text_rewrites').map((r) => r.name), ['solo-rationale-trim']);
});

test('ackStripRewrite still strips a bare text block after a deny', () => {
  const ctx = new Map([['priorUserWasDeny', true]]);
  const start = { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
  const delta = { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK.' } };
  const stop = { type: 'content_block_stop', index: 0 };
  assert.equal(ackStripRewrite('content_block_start', start, ctx), null);
  assert.equal(ackStripRewrite('content_block_delta', delta, ctx), null);
  assert.equal(ackStripRewrite('content_block_stop', stop, ctx), null);
});
