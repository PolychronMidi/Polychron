'use strict';

// Single source of truth for "how full is the context vs a target window".
// Before this, the swap size-gate, the outbound gate, and the compaction

const { PROJECT_ROOT } = require('./shared');

// Canonical model input budget = the full context window, 0 when unknown
// (callers MUST treat 0 as "do not gate" / fail open). This is the one resolver;
function inputBudgetFor(modelId) {
  const { modelOutputInfo } = require('./hme_proxy_request_mutation');
  const info = modelOutputInfo(modelId);
  if (info.context > 0) return info.context;
  if (info.maxInput > 0 && info.maxOutput > 0) return info.maxInput + info.maxOutput;
  if (info.maxInput > 0) return info.maxInput;
  return 0;
}

// Conservative input-token estimate for gates. Calibration may raise the estimate
// when a route's tokenizer is denser than the priors, but it must never lower a
// size gate below the static priors: fitted drift already proved that can ship a
// tool-result-heavy over-window payload upstream.
function estimateTokens(payload, env = process.env, projectRoot = PROJECT_ROOT, modelId = '') {
  const { semanticTokenEstimate } = require('./context_token_estimate');
  const { calibratedFactors } = require('./context_calibration');
  const prior = semanticTokenEstimate(payload, env, null);
  const calibrated = semanticTokenEstimate(payload, env, calibratedFactors(env, projectRoot, modelId));
  return Math.max(prior, calibrated);
}

// Unified pressure reading against a target model window.
//   { usedTokens, budget, fraction, headroom }
function contextPressure({ payload, modelId, env = process.env, projectRoot = PROJECT_ROOT } = {}) {
  const budget = inputBudgetFor(modelId);
  const usedTokens = estimateTokens(payload, env, projectRoot, modelId);
  const known = budget > 0;
  return {
    usedTokens,
    budget,
    fraction: known ? usedTokens / budget : null,
    headroom: known ? Math.max(0, budget - usedTokens) : null,
  };
}

module.exports = { inputBudgetFor, estimateTokens, contextPressure };
