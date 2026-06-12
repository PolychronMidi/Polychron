'use strict';
/**
 * Single source of truth for Claude/Anthropic model-family classification.
 *
 * The substring tests `model.includes('opus'|'sonnet'|'haiku')` and the
 * `claude-` / `provider/claude-` shape checks were scattered as inline regex
 * across overdrive_route.js (modelTier, claudeModelForOverdrive,
 * providerPrefixedClaudeModel) and hme_proxy_opus_gate.js (/opus/i). Those
 * drift independently. This module owns the family table; consumers import it.
 *
 * model_effort.js owns the orthogonal effort/reasoning axis -- keep them
 * separate (family != effort).
 */

// Ordered: first match wins. Tier is the overdrive capability band.
const FAMILY_TABLE = [
  { family: 'opus', tier: 'E5', needle: 'opus' },
  { family: 'sonnet', tier: 'E4', needle: 'sonnet' },
  { family: 'haiku', tier: 'E2', needle: 'haiku' },
];

// Tier when the model id matches no known family (overdrive default = top band).
const DEFAULT_TIER = 'E5';

function _norm(modelId) {
  return String(modelId || '').toLowerCase();
}

function family(modelId) {
  const m = _norm(modelId);
  for (const row of FAMILY_TABLE) {
    if (m.includes(row.needle)) return row.family;
  }
  return '';
}

function modelTier(modelId) {
  const m = _norm(modelId);
  for (const row of FAMILY_TABLE) {
    if (m.includes(row.needle)) return row.tier;
  }
  return DEFAULT_TIER;
}

function isOpus(modelId) {
  return family(modelId) === 'opus';
}

// A bare `claude-*` id (no provider prefix) -> returned as-is, else ''.
function claudeModel(modelId) {
  const raw = String(modelId || '');
  return raw.startsWith('claude-') ? raw : '';
}

// A `anthropic/claude-*` or `claude/claude-*` prefixed id -> the bare
// `claude-*` model, else ''.
function providerPrefixedClaudeModel(modelId) {
  const raw = String(modelId || '');
  const slash = raw.indexOf('/');
  if (slash < 0) return '';
  const provider = raw.slice(0, slash).toLowerCase();
  const bare = raw.slice(slash + 1);
  if (provider !== 'anthropic' && provider !== 'claude') return '';
  return bare.startsWith('claude-') ? bare : '';
}

module.exports = {
  FAMILY_TABLE,
  DEFAULT_TIER,
  family,
  modelTier,
  isOpus,
  claudeModel,
  providerPrefixedClaudeModel,
};
