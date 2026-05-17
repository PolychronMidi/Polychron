'use strict';

const { shrinkForPassthrough } = require('./passthrough_compact');
const { PROJECT_ROOT } = require('./shared');

function envNumber(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function createContextBudget() {
  const passthroughCompactBytes = parseInt(process.env.HME_PROXY_COMPACT_BYTES || '250000', 10);
  const compactBytesExplicit = process.env.HME_PROXY_COMPACT_BYTES != null
    && process.env.HME_PROXY_COMPACT_BYTES !== '';
  const keepMin = parseInt(process.env.HME_PROXY_COMPACT_KEEP_MIN || '100', 10);
  const staleToolKeepTurns = parseInt(process.env.HME_PROXY_STALE_TOOL_KEEP_TURNS || String(keepMin), 10);
  let lastInputTokensRemaining = null;
  let lastInputTokensLimit = null;
  let consecutive429s = 0;
  let lastPayloadBytes = 0;
  const bytesPerTokenEst = envNumber('HME_PROXY_BYTES_PER_TOKEN_EST', 3.5);
  const dynamicThresholdFloorBytes = parseInt(process.env.HME_PROXY_COMPACT_FLOOR_BYTES || '999000', 10);
  const modelContextFraction = envNumber('HME_PROXY_CONTEXT_FRACTION', 0.90);
  const contextPreflightFraction = envNumber('HME_PROXY_CONTEXT_PREFLIGHT_FRACTION', modelContextFraction);
  const contextSignalRemainingFraction = envNumber('HME_PROXY_CONTEXT_SIGNAL_REMAINING_FRACTION', 0.25);
  const contextBytesPerTokenEst = envNumber('HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST', 2.2);

  function effectiveCompactThreshold() {
    let ceiling;
    if (compactBytesExplicit) ceiling = passthroughCompactBytes;
    else if (lastInputTokensLimit != null && lastInputTokensLimit > 0) ceiling = Math.floor(lastInputTokensLimit * modelContextFraction * bytesPerTokenEst);
    else ceiling = passthroughCompactBytes;
    let panicCap = ceiling;
    if (consecutive429s > 0) panicCap = Math.max(dynamicThresholdFloorBytes, Math.floor(ceiling / Math.pow(2, consecutive429s)));
    let remainingCap = ceiling;
    if (lastInputTokensRemaining != null && lastInputTokensRemaining > 0) {
      const remainingFraction = Number(process.env.HME_PROXY_REMAINING_FRACTION || '0.80');
      remainingCap = Math.floor(lastInputTokensRemaining * remainingFraction * bytesPerTokenEst);
    }
    return Math.max(dynamicThresholdFloorBytes, Math.min(panicCap, remainingCap));
  }

  function resolveModelCtx(modelId) {
    const map = {
      'deepseek-v4-pro': 1048576, 'deepseek-v4-flash': 1048576,
      'mimo-v2.5-pro': 1048576, 'mimo-v2-pro': 1048576,
      'glm-5.1': 1048576, 'glm-5': 1048576,
      'kimi-k2.6': 1048576, 'kimi-k2.5': 1048576,
      'minimax-m2.7': 1048576, 'minimax-m2.5': 1048576,
      'qwen3.6-plus': 1048576, 'qwen3.5-plus': 1048576,
      'mistral-large-latest': 131072, 'gemini-2.5-flash': 1048576,
      'llama-4-maverick': 1048576, 'llama-3.3-70b': 131072,
      'gpt-5.5': 1050000, 'gpt-5.4': 400000, 'gpt-5.3': 400000, 'gpt-5.2': 400000,
      'gpt-4o': 200000, 'nemotron-super-49b': 131072, 'nemotron-3-nano': 131072,
    };
    for (const [k, v] of Object.entries(map)) if (String(modelId || '').includes(k)) return v;
    return 1000000;
  }

  function estimatedContextTokens(bytes) { return Math.ceil(bytes / contextBytesPerTokenEst); }
  function omniContextThresholdBytes(swapModel) { return Math.floor(resolveModelCtx(String(swapModel || '')) * contextPreflightFraction * contextBytesPerTokenEst); }

  function injectContextHeader(headers, swapModel) {
    const ctx = resolveModelCtx(swapModel);
    const estUsed = estimatedContextTokens(lastPayloadBytes);
    const remaining = Math.max(0, ctx - estUsed);
    if (remaining < ctx * contextSignalRemainingFraction) {
      headers['anthropic-ratelimit-input-tokens-remaining'] = String(remaining);
      console.error(`[hme-proxy] context signal: ~${estUsed}/${ctx} tokens (${remaining} remaining) -> triggering /compact`);
    }
  }

  function shrinkForProxyPassthrough(payload) {
    return shrinkForPassthrough(payload, {
      effectiveThreshold: effectiveCompactThreshold,
      keepMin,
      maxToolResultAge: staleToolKeepTurns,
      projectRoot: PROJECT_ROOT,
    });
  }

  function shrinkForOmniContext(payload, swapModel) {
    const threshold = omniContextThresholdBytes(swapModel);
    const before = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    if (before <= threshold) return 0;
    const changed = shrinkForPassthrough(payload, {
      threshold,
      keepMin,
      maxToolResultAge: staleToolKeepTurns,
      env: { ...process.env, HME_PROXY_LOCAL_SUMMARY: process.env.HME_PROXY_OMNI_LOCAL_SUMMARY || process.env.HME_PROXY_LOCAL_SUMMARY || '0' },
      log: (msg) => console.error(`[hme-proxy] omni-context ${msg}`),
      projectRoot: PROJECT_ROOT,
    });
    const after = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    console.error(`[hme-proxy] omni-context preflight: ${before}B -> ${after}B threshold=${threshold}B model=${swapModel} est=${estimatedContextTokens(after)}/${resolveModelCtx(String(swapModel || ''))} tokens changed=${changed}`);
    return changed;
  }

  return {
    effectiveCompactThreshold,
    shrinkForPassthrough: shrinkForProxyPassthrough,
    shrinkForContext: shrinkForOmniContext,
    injectContextHeader,
    getConsecutive429s: () => consecutive429s,
    setConsecutive429s: (n) => { consecutive429s = n; },
    incConsecutive429s: () => { consecutive429s = Math.min(consecutive429s + 1, 4); return consecutive429s; },
    getLastInputTokensRemaining: () => lastInputTokensRemaining,
    setLastInputTokensRemaining: (n) => { lastInputTokensRemaining = n; },
    getLastInputTokensLimit: () => lastInputTokensLimit,
    setLastInputTokensLimit: (n) => { lastInputTokensLimit = n; },
    setLastPayloadBytes: (n) => { lastPayloadBytes = n; },
  };
}

module.exports = { createContextBudget, envNumber };
