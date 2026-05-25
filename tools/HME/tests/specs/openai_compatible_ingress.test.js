'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const ingress = require('../../proxy/openai_compatible_ingress');

test('targetModelFor uses per-model provider instead of one default OpenCode prefix', () => {
  const cfg = {
    providers_to_skip: { providers: [] },
    tiers: { E4: { models: [
      { id: 'gpt-5.5-xhigh', provider: 'codex' },
      { id: 'qwen-free', provider: 'openrouter' },
    ] } },
  };
  assert.equal(ingress.targetModelFor('gpt-5.5-xhigh', cfg, {}), 'cx/gpt-5.5-xhigh');
  assert.equal(ingress.targetModelFor('qwen-free', cfg, {}), 'openrouter/qwen-free');
});

test('modelCatalog excludes skipped Claude Anthropic providers', () => {
  const cfg = {
    providers_to_skip: { providers: ['claude'] },
    tiers: { E5: { models: [
      { id: 'claude-opus', provider: 'anthropic' },
      { id: 'gpt-5.5-xhigh', provider: 'codex' },
    ] } },
  };
  const ids = ingress.modelCatalog(cfg, {}).map((m) => m.id);
  assert.deepEqual(ids, ['gpt-5.5-xhigh']);
});

test('routeOpenAICompatibleThroughHme sets HME upstream and model route', () => {
  const cfg = { providers_to_skip: { providers: [] }, tiers: { E5: { models: [{ id: 'qwen-free', provider: 'openrouter' }] } } };
  const req = { url: '/v1/chat/completions', headers: {} };
  const payload = { model: 'qwen-free' };
  const changed = ingress.routeOpenAICompatibleThroughHme(req, payload, { servicePort: () => 20128, cfg, env: {} });
  assert.equal(changed, true);
  assert.equal(req.headers['x-hme-upstream'], 'http://127.0.0.1:20128');
  assert.equal(payload.model, 'openrouter/qwen-free');
});

test('handleOpenAIModelsRoute serves registry-backed model list', () => {
  const cfg = { providers_to_skip: { providers: [] }, tiers: { E5: { models: [{ id: 'gpt-5.5-xhigh', provider: 'codex' }] } } };
  let status = 0;
  let body = '';
  const res = {
    writeHead(code) { status = code; },
    end(text) { body = text; },
  };
  const handled = ingress.handleOpenAIModelsRoute({ url: '/v1/models', headers: {} }, res, cfg, {});
  assert.equal(handled, true);
  assert.equal(status, 200);
  assert.equal(JSON.parse(body).data[0].id, 'gpt-5.5-xhigh');
});
