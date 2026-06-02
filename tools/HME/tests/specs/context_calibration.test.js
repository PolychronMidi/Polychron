'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { fitFactors, recordSample, calibratedFactors, loadCalibration, MIN_SAMPLES_TO_FIT } = require('../../proxy/context_calibration');
const { semanticTokenEstimate } = require('../../proxy/context_token_estimate');

const PRIORS = { perTok: 2.6, toolResultPerTok: 1.8 };
// Apply/record are gated behind this flag so the estimator stays deterministic
// for callers that don't opt in; calibration tests must enable it explicitly.
const CAL_ENV = { HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST: '2.6', HME_PROXY_TOOL_RESULT_BYTES_PER_TOKEN_EST: '1.8', HME_PROXY_ESTIMATOR_CALIBRATION: '1' };

test('fitFactors keeps priors below the minimum sample count', () => {
  const r = fitFactors([{ reg: 1000, tr: 2000, actual: 1500 }], PRIORS);
  assert.equal(r.fitted, false);
  assert.equal(r.perTok, PRIORS.perTok);
  assert.equal(r.toolResultPerTok, PRIORS.toolResultPerTok);
});

test('fitFactors recovers known per-bucket ratios from synthetic ground truth', () => {
  // Ground truth: regular bytes tokenize at 3.0 B/tok, tool_result at 1.5 B/tok.
  // actual = reg/3 + tr/1.5. Vary the mix so the two buckets are separable.
  const samples = [];
  for (let i = 0; i < 60; i += 1) {
    const reg = 20000 + i * 800;
    const tr = 120000 - i * 1500;
    samples.push({ reg, tr, actual: Math.round(reg / 3.0 + tr / 1.5) });
  }
  const r = fitFactors(samples, PRIORS);
  assert.equal(r.fitted, true);
  assert.ok(Math.abs(r.perTok - 3.0) < 0.15, `perTok ~3.0, got ${r.perTok}`);
  assert.ok(Math.abs(r.toolResultPerTok - 1.5) < 0.1, `toolResultPerTok ~1.5, got ${r.toolResultPerTok}`);
});

test('fitFactors falls back to priors when buckets are collinear (ill-conditioned)', () => {
  // tool_result always zero -> cannot separate the two ratios.
  const samples = [];
  for (let i = 0; i < 60; i += 1) samples.push({ reg: 50000 + i * 1000, tr: 0, actual: Math.round((50000 + i * 1000) / 2.6) });
  const r = fitFactors(samples, PRIORS);
  // Either it declines to fit the tool bucket (keeps prior) -- never invents a ratio.
  assert.equal(r.toolResultPerTok, PRIORS.toolResultPerTok);
});

test('fitFactors clamps absurd fits to sane bytes/token bounds', () => {
  const samples = [];
  for (let i = 0; i < 60; i += 1) {
    const reg = 10000 + i * 500;
    const tr = 10000 + i * 137;
    // Pretend actual is enormous -> implies <1 byte/token -> must clamp, not explode.
    samples.push({ reg, tr, actual: (reg + tr) * 50 });
  }
  const r = fitFactors(samples, PRIORS);
  assert.ok(r.perTok >= 1.0 && r.perTok <= 8.0);
  assert.ok(r.toolResultPerTok >= 1.0 && r.toolResultPerTok <= 8.0);
});

test('recordSample persists, re-fits, and calibratedFactors reads the fit; estimator consumes it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-calib-'));
  const env = CAL_ENV;
  try {
    // Before any data: factors fall back to env priors.
    let f = calibratedFactors(env, dir);
    assert.equal(f.perTok, 2.6);
    assert.equal(f.toolResultPerTok, 1.8);

    // Feed ground-truth samples (reg @3.0, tr @1.5) for one model route.
    for (let i = 0; i < MIN_SAMPLES_TO_FIT + 10; i += 1) {
      const reg = 30000 + i * 700;
      const tr = 90000 - i * 900;
      recordSample({ reg, tr, actual: Math.round(reg / 3.0 + tr / 1.5), model: 'gpt-5.5-xhigh', env, projectRoot: dir });
    }
    const data = loadCalibration(dir);
    assert.ok(data && data.global && data.global.factors && data.global.factors.fitted, 'global fit persisted');
    assert.ok(data.models && data.models['gpt-5.5-xhigh'] && data.models['gpt-5.5-xhigh'].factors.fitted, 'per-model fit persisted');
    // Per-model lookup wins; cross-model global is the fallback for an unseen route.
    f = calibratedFactors(env, dir, 'gpt-5.5-xhigh');
    assert.ok(Math.abs(f.perTok - 3.0) < 0.2, `calibrated perTok ~3.0, got ${f.perTok}`);
    assert.ok(Math.abs(f.toolResultPerTok - 1.5) < 0.15, `calibrated toolResultPerTok ~1.5, got ${f.toolResultPerTok}`);
    const unseen = calibratedFactors(env, dir, 'some-other-model');
    assert.ok(Math.abs(unseen.perTok - 3.0) < 0.2, 'unseen route falls back to the global fit');

    // The estimator, given calibrated factors, produces a HIGHER estimate for a
    // tool-result-heavy payload than with the (looser) priors -- closing the
    const payload = { model: 'm', system: '', tools: [], messages: [
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'x'.repeat(400000) }] },
    ] };
    const withPriors = semanticTokenEstimate(payload, env, null);
    const withCalib = semanticTokenEstimate(payload, env, f);
    assert.ok(withCalib > withPriors, `calibrated estimate ${withCalib} > prior estimate ${withPriors}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('recordSample ignores sub-threshold / empty samples', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-calib-'));
  try {
    assert.equal(recordSample({ reg: 10, tr: 0, actual: 5, projectRoot: dir }), null, 'tiny turn ignored');
    assert.equal(recordSample({ reg: 0, tr: 0, actual: 5000, projectRoot: dir }), null, 'zero-byte ignored');
    assert.equal(loadCalibration(dir), null, 'nothing persisted');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
