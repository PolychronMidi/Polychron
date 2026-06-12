'use strict';
// A 502 bad_gateway from a shared upstream backend (e.g. codex/chatgpt.com) hits
// every model tier behind it, so advancing to a sibling tier just re-hits the
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { requireEnv } = require('../../proxy/shared/load_env');

process.env.PROJECT_ROOT = requireEnv('PROJECT_ROOT');

const health = require('../../proxy/contexts/failure_policy/model_route_health');
const { buildMode1Chain } = require('../../proxy/overdrive_route');
const { recordOmniRouteFailureAdvance } = require('../../proxy/contexts/failure_policy/hme_proxy_codex');
const { omniProviderForConfigProvider } = require('../../proxy/omniroute_protocol');

function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'hme-provcd-')); }

test('markProviderCooldown writes a provider key, skips during window, expires after ttl', () => {
  const root = tmpRoot();
  const now = Date.parse('2026-06-02T00:00:00Z');
  try {
    health.markProviderCooldown('codex', 'upstream_5xx status=502', { projectRoot: root, now, ttlMs: 60_000 });
    const state = health.loadModelRouteHealth(root);
    assert.deepEqual(Object.keys(state), ['provider/codex']);
    assert.equal(health.providerSkipReason('codex', state, {}, now + 1_000), 'upstream_5xx status=502');
    assert.equal(health.providerSkipReason('codex', state, {}, now + 61_000), '', 'expires after ttl');
    // underscore<->dash normalization: writer and reader agree on the key
    assert.equal(health.providerCooldownKey('open_ai'), 'provider/open-ai');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a cooled-down provider is dropped from the built chain; siblings on it go too', () => {
  const cfg = {
    providers_to_skip: { providers: [] },
    ranking_rules: { cost_order: ['free'] },
    manually_toprank: { E5: [] },
    team_role_models: { driver: { tier: 'E5', source: 'ranking_rules' } },
    tiers: { E5: { models: [
      { id: 'gpt-5.5-xhigh', provider: 'codex', cost: 'free', tier_score: 9 },
      { id: 'gpt-5.5-high', provider: 'codex', cost: 'free', tier_score: 8 },
      { id: 'deepseek-v4-pro', provider: 'kilo-gateway', cost: 'free', tier_score: 5 },
    ] } },
  };
  const payload = { model: 'claude-sonnet-4-6', messages: [] };
  const healthy = buildMode1Chain(payload, { HME_TEAM_ROLE: 'driver' }, cfg, { routeHealth: {} });
  assert.ok(healthy.chain.some((m) => m.provider === 'codex'), 'codex present when healthy');

  const key = health.providerCooldownKey(omniProviderForConfigProvider('codex'));
  const routeHealth = { [key]: { status: 'cooldown', reason: 'bad_gateway', until: '2099-01-01T00:00:00Z' } };
  const cooled = buildMode1Chain(payload, { HME_TEAM_ROLE: 'driver' }, cfg, { routeHealth });
  assert.equal(cooled.chain.some((m) => m.provider === 'codex'), false, 'BOTH codex tiers skipped');
  assert.ok(cooled.chain.some((m) => m.provider === 'kilo-gateway'), 'fails over to a different provider');
});

test('a 5xx advance parks the provider on cooldown; a non-5xx advance does not', () => {
  const root = tmpRoot();
  const prevThreshold = process.env.HME_OMNI_SWAP_FAIL_THRESHOLD;
  process.env.HME_OMNI_SWAP_FAIL_THRESHOLD = '1'; // advance on first failure
  const chain = [{ id: 'gpt-5.5-xhigh', provider: 'codex' }, { id: 'deepseek-v4-pro', provider: 'kilo-gateway' }];
  try {
    recordOmniRouteFailureAdvance({
      isOmniRouteSwap: true, swapChain: chain, odMode: '1',
      omniProvider: 'codex', swapModel: 'gpt-5.5-xhigh', status: 502, isRateLimit: false, projectRoot: root,
    });
    assert.equal(
      health.providerSkipReason('codex', health.loadModelRouteHealth(root), {}, Date.now()),
      'upstream_5xx status=502',
      '502 advance must cool the provider',
    );

    const root2 = tmpRoot();
    recordOmniRouteFailureAdvance({
      isOmniRouteSwap: true, swapChain: chain, odMode: '1',
      omniProvider: 'codex', swapModel: 'gpt-5.5-xhigh', status: 429, isRateLimit: true, projectRoot: root2,
    });
    assert.equal(
      health.providerSkipReason('codex', health.loadModelRouteHealth(root2), {}, Date.now()),
      '',
      '429 (non-5xx) must NOT cool the whole provider',
    );
    fs.rmSync(root2, { recursive: true, force: true });
  } finally {
    if (prevThreshold === undefined) delete process.env.HME_OMNI_SWAP_FAIL_THRESHOLD;
    else process.env.HME_OMNI_SWAP_FAIL_THRESHOLD = prevThreshold;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
