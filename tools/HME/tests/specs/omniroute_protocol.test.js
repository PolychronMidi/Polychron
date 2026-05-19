'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  omniProviderForConfigProvider,
  isCodexOmniTarget,
  omniTargetFormat,
  providerRequestOverrides,
  providerRequiresNonStream,
  firstLegacyChatCandidate,
} = require('../../proxy/omniroute_protocol');

test('codex config provider resolves to cx responses target', () => {
  assert.equal(omniProviderForConfigProvider('codex'), 'cx');
  assert.equal(isCodexOmniTarget('cx'), true);
  assert.equal(isCodexOmniTarget('codex'), true);
  assert.equal(omniTargetFormat('cx'), 'openai-responses');
});

test('non-codex providers keep provider-default target format', () => {
  assert.equal(omniProviderForConfigProvider('opencode_go'), 'opencode-go');
  assert.equal(omniProviderForConfigProvider('kilo'), 'kilo-gateway');
  assert.equal(omniProviderForConfigProvider('kilo-gateway'), 'kilo-gateway');
  assert.equal(omniProviderForConfigProvider('aihubmix'), 'aihubmix');
  assert.equal(omniTargetFormat('opencode-go'), 'provider-default');
  assert.equal(omniTargetFormat('openrouter'), 'provider-default');
  assert.equal(omniTargetFormat('kilo-gateway'), 'provider-default');
  assert.equal(omniTargetFormat('aihubmix'), 'provider-default');
});

test('provider capability matrix drives request overrides', () => {
  const cfg = {
    provider_capabilities: {
      'kilo-gateway': { request_overrides: { non_stream: true } },
      aihubmix: { request_overrides: { non_stream: true } },
      openrouter: { request_overrides: {} },
    },
  };
  assert.deepEqual(providerRequestOverrides('kilo', {}, cfg), { non_stream: true });
  assert.equal(providerRequiresNonStream('kilo-gateway', {}, cfg), true);
  assert.equal(providerRequiresNonStream('aihubmix', {}, cfg), true);
  assert.equal(providerRequiresNonStream('openrouter', {}, cfg), false);
});

test('Anthropic config provider prefers Claude OAuth unless API key is present', () => {
  assert.equal(omniProviderForConfigProvider('anthropic', {}), 'claude');
  assert.equal(omniProviderForConfigProvider('anthropic', { ANTHROPIC_API_KEY: 'fake' }), 'anthropic');
});

test('legacy chat fallback skips codex responses models', () => {
  const chain = [
    { id: 'gpt-5.5-xhigh', provider: 'codex' },
    { id: 'deepseek-v4-pro-go', provider: 'opencode-go' },
  ];
  const hit = firstLegacyChatCandidate(chain, 0);
  assert.equal(hit.idx, 1);
  assert.equal(hit.model.id, 'deepseek-v4-pro-go');
});

test('legacy chat fallback returns null when only codex remains', () => {
  assert.equal(firstLegacyChatCandidate([{ id: 'gpt-5.5-low', provider: 'codex' }]), null);
});
