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

// Calibrated input-token estimate for a payload (uses the learned bytes/token
// when the feedback loop is enabled and fitted, else the env prior).
function estimateTokens(payload, env = process.env, projectRoot = PROJECT_ROOT) {
  const { semanticTokenEstimate } = require('./context_token_estimate');
  const { calibratedFactors } = require('./context_calibration');
  return semanticTokenEstimate(payload, env, calibratedFactors(env, projectRoot));
}

// Unified pressure reading against a target model window.
//   { usedTokens, budget, fraction, headroom }
function contextPressure({ payload, modelId, env = process.env, projectRoot = PROJECT_ROOT } = {}) {
  const budget = inputBudgetFor(modelId);
  const usedTokens = estimateTokens(payload, env, projectRoot);
  const known = budget > 0;
  return {
    usedTokens,
    budget,
    fraction: known ? usedTokens / budget : null,
    headroom: known ? Math.max(0, budget - usedTokens) : null,
  };
}

module.exports = { inputBudgetFor, estimateTokens, contextPressure };
