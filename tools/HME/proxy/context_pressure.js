'use strict';

// Single source of truth for "how full is the context vs a target window".
// Before this, the swap size-gate, the outbound gate, and the compaction

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./shared');

const _STATUSLINE_STALE_MS = 5 * 60 * 1000;

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function _statuslineFile(env = process.env, projectRoot = PROJECT_ROOT) {
  return (env && env.HME_STATUSLINE_PATH)
    || path.join(projectRoot || process.cwd(), 'tools', 'HME', 'runtime', 'claude-statusline-raw.json');
}

// Real Claude-window usage from the statusline truth file (the same source the
// autocompact widget and proxy compaction read), 0 when absent/stale. This is the
function statuslineUsage(env = process.env, projectRoot = PROJECT_ROOT) {
  try {
    const file = _statuslineFile(env, projectRoot);
    const stat = fs.statSync(file);
    if ((Date.now() - stat.mtimeMs) > _STATUSLINE_STALE_MS) return { used: 0, size: 0, modelId: '' };
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const ctx = (data && data.context_window) || {};
    const usage = ctx.current_usage || {};
    const used = positiveNumber(usage.input_tokens)
        + positiveNumber(usage.cache_read_input_tokens)
        + positiveNumber(usage.cache_creation_input_tokens)
      || positiveNumber(ctx.total_input_tokens);
    const size = positiveNumber(ctx.context_window_size);
    const modelId = String((data && data.model && (data.model.id || data.model.api_model)) || '');
    return { used, size, modelId };
  } catch (_e) {
    return { used: 0, size: 0, modelId: '' };  // silent-ok: absent/corrupt statusline = no ground truth
  }
}

// Canonical model INPUT budget, 0 when unknown (callers MUST treat 0 as
// "do not gate" / fail open). Prefer the registry's sanitized max_input_tokens:
// full context_length includes output/reserved tokens and can ship payloads that
function inputBudgetFor(modelId) {
  const { modelOutputInfo } = require('./hme_proxy_request_mutation');
  const info = modelOutputInfo(modelId);
  if (info.maxInput > 0) return info.maxInput;
  if (info.context > 0 && info.maxOutput > 0) return Math.max(1, info.context - info.maxOutput);
  if (info.context > 0) return info.context;
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
//   { usedTokens, budget, source, semanticTokens, statuslineTokens, fraction, headroom }
// preferStatusline: when true and the statusline truth file is fresh with real
function contextPressure({ payload, modelId, env = process.env, projectRoot = PROJECT_ROOT, preferStatusline = false } = {}) {
  const budget = inputBudgetFor(modelId);
  const semanticTokens = estimateTokens(payload, env, projectRoot, modelId);
  const sl = preferStatusline ? statuslineUsage(env, projectRoot) : { used: 0, size: 0, modelId: '' };
  const statuslineTokens = sl.used || 0;
  const usedTokens = preferStatusline && statuslineTokens > 0 ? statuslineTokens : semanticTokens;
  const source = preferStatusline && statuslineTokens > 0 ? 'statusline' : 'semantic';
  const known = budget > 0;
  return {
    usedTokens,
    semanticTokens,
    statuslineTokens,
    statuslineModel: sl.modelId || '',
    budget,
    source,
    fraction: known ? usedTokens / budget : null,
    headroom: known ? Math.max(0, budget - usedTokens) : null,
  };
}

module.exports = { inputBudgetFor, estimateTokens, contextPressure, statuslineUsage };
