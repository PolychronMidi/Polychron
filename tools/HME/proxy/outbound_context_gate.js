'use strict';
// Final outbound context-budget gate. The single invariant that holds no matter
// WHY a payload is over-window (OmniRoute swap to a smaller-context target,

const fs = require('fs');
const path = require('path');
const { emit, PROJECT_ROOT } = require('./shared');
const { semanticTokenEstimate } = require('./context_token_estimate');
const { compactLargeInteractiveAnthropicPayload, modelOutputInfo } = require('./hme_proxy_request_mutation');

// Resolved input budget for a model id: declared max_input_tokens wins;
// otherwise context_length minus the output reservation. One number -- callers
function inputBudgetFor(modelId) {
  const info = modelOutputInfo(modelId);
  if (info.maxInput > 0) return info.maxInput;
  if (info.context > 0) return Math.max(1024, info.context - (info.maxOutput || 0));
  return 0; // unknown -> no gate (fail open; never block on missing config)
}

// Estimate the final outbound input size of `payload` (post-mutation).
function estimateInputTokens(payload, env) {
  return semanticTokenEstimate(payload, env);
}

// Reroute helper: from a swap chain, pick the first model whose input budget
// fits `tokens` and differs from the current model. Returns the model entry or
function pickLargerRoute(swapChain, tokens, currentModelId, budgetFor = inputBudgetFor) {
  if (!Array.isArray(swapChain)) return null;
  for (const m of swapChain) {
    const id = m && (m.api_model || m.id);
    if (!id || id === currentModelId) continue;
    const budget = budgetFor(id);
    if (budget > 0 && tokens <= budget) return m;
  }
  return null;
}

// Core gate. Mutates `payload` in place when it compacts. Returns a verdict:
//   { ok: true, action: 'fit'|'compacted'|'rerouted', model, tokens, budget, reroute? }
function evaluateOutbound({ payload, modelId, swapChain = [], env = process.env, deps = {} }) {
  const compact = deps.compact || compactLargeInteractiveAnthropicPayload;
  const estimate = deps.estimate || estimateInputTokens;
  const budgetFor = deps.inputBudgetFor || inputBudgetFor;

  let budget = budgetFor(modelId);
  let tokens = estimate(payload, env);
  if (budget <= 0 || tokens <= budget) {
    return { ok: true, action: 'fit', model: modelId, tokens, budget };
  }
  // Tier 1: compact again to fit (cheapest; preserves the chosen model).
  try { compact(payload); } catch (_e) { /* silent-ok: compaction best-effort */ }
  tokens = estimate(payload, env);
  if (tokens <= budget) {
    return { ok: true, action: 'compacted', model: modelId, tokens, budget };
  }
  // Tier 2: reroute to a larger-context route in the swap chain.
  const larger = pickLargerRoute(swapChain, tokens, modelId, budgetFor);
  if (larger) {
    const newId = larger.api_model || larger.id;
    return { ok: true, action: 'rerouted', model: newId, reroute: larger, tokens, budget: budgetFor(newId) };
  }
  // Tier 3: fail locally with an actionable reason. Never ship over-window.
  return { ok: false, action: 'over_window', model: modelId, tokens, budget };
}

module.exports = { evaluateOutbound, inputBudgetFor, estimateInputTokens, pickLargerRoute };
