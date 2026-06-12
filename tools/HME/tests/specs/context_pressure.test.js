'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { inputBudgetFor, estimateTokens, contextPressure } = require('../../proxy/context_pressure');
const { semanticTokenEstimate } = require('../../proxy/context_token_estimate');
const { recordSample, MIN_SAMPLES_TO_FIT } = require('../../proxy/context_calibration');

const BIG = { model: 'cx/gpt-5.5-xhigh', system: '', tools: [], messages: [{ role: 'user', content: 'x'.repeat(200000) }] };

test('inputBudgetFor resolves the model context window and 0 for unknown (fail open)', () => {
  assert.equal(inputBudgetFor('gpt-5.5-xhigh'), 480000);
  assert.equal(inputBudgetFor('no-such-model-zzz'), 0);
});

test('contextPressure is the single used-vs-budget reading; null fraction when budget unknown', () => {
  const env = { HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST: '4' };
  const known = contextPressure({ payload: BIG, modelId: 'gpt-5.5-xhigh', env });
  assert.equal(known.budget, 480000);
  assert.ok(known.usedTokens > 0);
  assert.ok(known.fraction > 0 && known.fraction === known.usedTokens / 480000);
  assert.equal(known.headroom, Math.max(0, 480000 - known.usedTokens));

  const unknown = contextPressure({ payload: BIG, modelId: 'no-such-model-zzz', env });
  assert.equal(unknown.budget, 0);
  assert.equal(unknown.fraction, null, 'no phantom window to divide by');
  assert.equal(unknown.headroom, null);
});

test('estimateTokens matches the estimator with priors when calibration is disabled', () => {
  // No HME_PROXY_ESTIMATOR_CALIBRATION flag -> calibratedFactors returns priors,
  // so the shared estimate equals the bare estimator. Deterministic.
  const env = { HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST: '4' };
  assert.equal(estimateTokens(BIG, env), semanticTokenEstimate(BIG, env, null));
});

test('swap size-gate and outbound gate now read the SAME budget resolver', () => {
  const { swapWindowCheck } = require('../../proxy/overdrive_route');
  const { inputBudgetFor: gateBudget } = require('../../proxy/outbound_context_gate');
  const wc = swapWindowCheck(BIG, 'gpt-5.5-xhigh', { HME_OMNI_SWAP_FIT_FRACTION: '0.95', HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST: '4' });
  assert.equal(wc.budget, gateBudget('gpt-5.5-xhigh'), 'one budget resolver feeds both gates');
  assert.equal(wc.budget, inputBudgetFor('gpt-5.5-xhigh'));
});

test('estimateTokens is conservative when calibration would lower a size gate', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-pressure-calib-'));
  const env = {
    HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST: '2.6',
    HME_PROXY_TOOL_RESULT_BYTES_PER_TOKEN_EST: '1.8',
    HME_PROXY_ESTIMATOR_CALIBRATION: '1',
  };
  const payload = { model: 'cx/gpt-5.5-xhigh', system: '', tools: [], messages: [
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'x'.repeat(820000) }] },
  ] };
  try {
    for (let i = 0; i < MIN_SAMPLES_TO_FIT + 20; i += 1) {
      const reg = 5000 + i * 50;
      const tr = 300000 + i * 1500;
      recordSample({ reg, tr, actual: Math.round(reg / 5.0 + tr / 3.5), model: 'gpt-5.5-xhigh', env, projectRoot: dir });
    }
    const prior = semanticTokenEstimate(payload, env, null);
    assert.ok(estimateTokens(payload, env, dir, 'gpt-5.5-xhigh') >= prior);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
