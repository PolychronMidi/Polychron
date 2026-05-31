'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const { swapWindowCheck } = require('../../proxy/overdrive_route');

// Deterministic estimator env: 4 bytes/token, 0.95 fit fraction.
const ENV = { HME_OMNI_SWAP_FIT_FRACTION: '0.95', HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST: '4' };

// ~520K input tokens (2.08M chars / 4): over cx/gpt-5.5-xhigh's 500K context
// window, well under Opus-4-8's 1M context window.
const BIG = { system: '', tools: [], messages: [{ role: 'user', content: 'x'.repeat(2_080_000) }] };
const SMALL = { system: '', tools: [], messages: [{ role: 'user', content: 'hello world' }] };

test('oversized payload exceeds a small-window swap model (gpt-5.5-xhigh)', () => {
  const wc = swapWindowCheck(BIG, 'gpt-5.5-xhigh', ENV);
  assert.equal(wc.budget, 500000, 'reads gpt-5.5-xhigh context_length from models.json');
  assert.equal(wc.exceeds, true);
});

test('same oversized payload still FITS a big-window model (claude-opus-4-8)', () => {
  const wc = swapWindowCheck(BIG, 'claude-opus-4-8', ENV);
  assert.equal(wc.budget, 1000000);
  assert.equal(wc.exceeds, false, 'must not gate when the target has room');
});

test('small payload never exceeds', () => {
  assert.equal(swapWindowCheck(SMALL, 'gpt-5.5-xhigh', ENV).exceeds, false);
});

test('unknown model (budget 0) never gates', () => {
  const wc = swapWindowCheck(BIG, 'no-such-model-xyz', ENV);
  assert.equal(wc.budget, 0);
  assert.equal(wc.exceeds, false);
});
