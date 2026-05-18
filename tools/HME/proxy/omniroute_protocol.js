'use strict';

function omniProviderForConfigProvider(provider, env = process.env) {
  const p = String(provider || '').trim();
  if (p === 'codex') return 'cx';
  if (p === 'anthropic' && !env.ANTHROPIC_API_KEY) return 'claude';
  if (p === 'opencode_go' || p === 'opencode-go') return 'opencode-go';
  if (p === 'opencode') return 'opencode';
  return p || 'opencode-go';
}

function isCodexOmniTarget(provider) {
  const p = omniProviderForConfigProvider(provider);
  return p === 'cx' || p === 'codex';
}

function omniTargetFormat(provider) {
  return isCodexOmniTarget(provider) ? 'openai-responses' : 'provider-default';
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
  firstLegacyChatCandidate,
};
