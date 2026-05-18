'use strict';

const VALID_EFFORTS = new Set(['max', 'xhigh', 'high', 'medium', 'low']);
const REASONING_EFFORT = {
  max: 'xhigh',
  xhigh: 'xhigh',
  high: 'high',
  medium: 'medium',
  low: 'low',
};

function normalizedEffort(model) {
  const effort = String(model && model.effort_level || '').trim().toLowerCase();
  return VALID_EFFORTS.has(effort) ? effort : '';
}

function effortParamsForProvider(model, provider) {
  const effort = normalizedEffort(model);
  if (!effort) return null;
  const p = String(provider || model.provider || '').trim();
  if (p === 'anthropic' || p === 'claude') return null;
  if (p === 'codex' || p === 'cx' || p === 'openai' || p === 'openai-responses') {
    const value = REASONING_EFFORT[effort];
    return { reasoning_effort: value, reasoning_summary: 'detailed', reasoning: { effort: value, summary: 'detailed' } };
  }
  return null;
}

function applyEffortParams(payload, model, provider) {
  const params = effortParamsForProvider(model, provider);
  if (!params || !payload || typeof payload !== 'object') return false;
  Object.assign(payload, params);
  return true;
}

module.exports = {
  VALID_EFFORTS,
  normalizedEffort,
  effortParamsForProvider,
  applyEffortParams,
};
