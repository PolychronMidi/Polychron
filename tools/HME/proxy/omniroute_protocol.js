'use strict';

function omniProviderForConfigProvider(provider, env = process.env) {
  const p = String(provider || '').trim();
  if (p === 'codex') return 'cx';
  if (p === 'anthropic') return 'claude';
  if (p === 'opencode_go' || p === 'opencode-go') return 'opencode-go';
  if (p === 'opencode') return 'opencode';
  if (p === 'kilo') return 'kilo-gateway';
  if (p === 'kilo-gateway') return 'kilo-gateway';
  if (p === 'aihubmix') return 'aihubmix';
  return p || 'opencode-go';
}

function isCodexOmniTarget(provider) {
  const p = omniProviderForConfigProvider(provider);
  return p === 'cx' || p === 'codex';
}

function omniTargetFormat(provider) {
  return isCodexOmniTarget(provider) ? 'openai-responses' : 'provider-default';
}

function providerCapabilitiesForConfigProvider(provider, env = process.env, cfg = null) {
  const caps = cfg && cfg.provider_capabilities;
  if (!caps || typeof caps !== 'object') return null;
  const raw = String(provider || '').trim();
  const p = omniProviderForConfigProvider(provider, env);
  const hit = caps[p] || caps[raw];
  return hit && typeof hit === 'object' ? hit : null;
}

function providerRequestOverrides(provider, env = process.env, cfg = null) {
  const cap = providerCapabilitiesForConfigProvider(provider, env, cfg);
  const out = {};
  if (cap && cap.request_overrides && typeof cap.request_overrides === 'object') {
    Object.assign(out, cap.request_overrides);
  }
  if (cap && cap.requires_non_stream === true && out.non_stream === undefined) out.non_stream = true;
  return out;
}

function providerRequiresNonStream(provider, env = process.env, cfg = null) {
  return providerRequestOverrides(provider, env, cfg).non_stream === true;
}

function firstLegacyChatCandidate(chain, startIdx = 0) {
  if (!Array.isArray(chain) || chain.length === 0) return null;
  const start = Number.isInteger(startIdx) ? Math.max(0, startIdx) : 0;
  for (let offset = 0; offset < chain.length; offset++) {
    const idx = (start + offset) % chain.length;
    const model = chain[idx];
    if (!model || isCodexOmniTarget(model.provider)) continue;
    return { model, idx };
  }
  return null;
}

module.exports = {
  omniProviderForConfigProvider,
  isCodexOmniTarget,
  omniTargetFormat,
  providerCapabilitiesForConfigProvider,
  providerRequestOverrides,
  providerRequiresNonStream,
  firstLegacyChatCandidate,
};
