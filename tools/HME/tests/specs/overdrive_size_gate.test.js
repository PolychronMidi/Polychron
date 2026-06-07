'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { applyOverdriveRoute, swapWindowCheck } = require('../../proxy/overdrive_route');

// Deterministic estimator env: 4 bytes/token, 0.95 fit fraction.
const NO_STATUSLINE = path.join(os.tmpdir(), 'hme-size-gate-no-statusline');
const ENV = { HME_OMNI_SWAP_FIT_FRACTION: '0.95', HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST: '4', HME_STATUSLINE_PATH: NO_STATUSLINE };

// ~520K input tokens (2.08M chars / 4): over cx/gpt-5.5-xhigh's 480K context
// window, well under Opus-4-8's 1M context window.
const BIG = { system: '', tools: [], messages: [{ role: 'user', content: 'x'.repeat(2_080_000) }] };
const SMALL = { system: '', tools: [], messages: [{ role: 'user', content: 'hello world' }] };

test('oversized payload exceeds a small-window swap model (gpt-5.5-xhigh)', () => {
  const wc = swapWindowCheck(BIG, 'gpt-5.5-xhigh', ENV);
  assert.equal(wc.budget, 480000, 'reads gpt-5.5-xhigh context_length from models.json');
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

test('fresh statusline usage grounds swap size gate and prevents false semantic bailout', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-size-statusline-'));
  const statusline = path.join(dir, 'statusline.json');
  fs.writeFileSync(statusline, JSON.stringify({
    model: { id: 'gpt-5.5-xhigh' },
    context_window: {
      context_window_size: 480000,
      current_usage: { input_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  }));
  try {
    const wc = swapWindowCheck(BIG, 'gpt-5.5-xhigh', { ...ENV, HME_STATUSLINE_PATH: statusline }, dir);
    assert.equal(wc.source, 'statusline');
    assert.equal(wc.estTokens, 1000);
    assert.equal(wc.exceeds, false, 'real under-window usage must not be overruled by semantic estimate');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('size gate never falls back direct to a provider listed in providers_to_skip', () => {
  const cfg = {
    providers_to_skip: { providers: ['anthropic', 'claude'] },
    ranking_rules: { cost_order: ['free'] },
    team_role_models: { driver: { tier: 'E5', source: 'ranking_rules' } },
    manually_toprank: { E5: [] },
    tiers: { E5: { models: [
      { id: 'gpt-5.5-xhigh', api_model: 'gpt-5.5-xhigh', provider: 'codex', cost: 'free', tier_score: 10 },
    ] } },
  };
  const payload = { model: 'claude-sonnet-4-6', system: '', tools: [], stream: true, messages: BIG.messages };
  const clientReq = { headers: {}, url: '/v1/messages' };
  const clientRes = { writeHead() {}, end() {} };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-size-root-'));
  const result = applyOverdriveRoute({ payload, clientReq, clientRes, outBody: Buffer.from('{}'), env: { ...ENV, OVERDRIVE_MODE: '1' }, cfg, projectRoot: root });
  try {
    assert.equal(result.applied, true);
    assert.equal(result.isOmniRoute, true);
    assert.match(payload.model, /^cx\/gpt-5\.5-xhigh/);
    assert.ok(clientReq.headers['x-hme-upstream'], 'must route through OmniRoute, not direct Anthropic');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
