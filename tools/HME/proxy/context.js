'use strict';
// Jurisdiction context + session-status injection orchestrator.
// Heavy lifting lives in context_jurisdiction.js / context_status.js.

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./shared');
const hmePaths = require('./infra/hme_paths');

const INJECT = (process.env.HME_PROXY_INJECT ?? '1') !== '0';
const REFRESH_INTERVAL_MS = 60_000;

const COHERENCE_BUDGET_PATH = hmePaths.hmeMetric('hme-coherence-budget.json');
let _budgetState = null;
let _budgetLoadedAt = 0;

function loadCoherenceBudget() {
  const now = Date.now();
  if (_budgetState !== null && now - _budgetLoadedAt < REFRESH_INTERVAL_MS) return _budgetState;
  try {
    const raw = fs.readFileSync(COHERENCE_BUDGET_PATH, 'utf8');
    const data = JSON.parse(raw);
    const score = data.current_coherence;
    const band = data.band;
    if (typeof score === 'number' && Array.isArray(band) && band.length === 2) {
      if (score < band[0]) _budgetState = 'below';
      else if (score > band[1]) _budgetState = 'above';
      else _budgetState = 'in_band';
    }
  } catch (_err) {
    // silent-ok: optional fallback path.
    _budgetState = 'in_band';
  }
  _budgetLoadedAt = now;
  return _budgetState;
}

function shouldInject() {
  if (!INJECT) return false;
  return loadCoherenceBudget() !== 'above';
}

function stripSystemCacheControl(payload) {
  // Strip ALL cache_control from system blocks. Old proxy versions added them;
  // stale markers in conversation history cause Anthropic 400 TTL ordering errors.
  if (!Array.isArray(payload.system)) return false;
  let stripped = false;
  for (const b of payload.system) {
    if (b && b.cache_control) { delete b.cache_control; stripped = true; }
  }
  return stripped;
}

// Strip the `ttl` field from every cache_control object. The OAuth-public
function normalizeCacheControlTtls(payload) {
  let changed = 0;
  const stripTtl = (block) => {
    if (!block || !block.cache_control) return;
    if (block.cache_control.ttl != null) {
      delete block.cache_control.ttl;
      changed++;
    }
  };
  if (Array.isArray(payload.tools)) for (const t of payload.tools) stripTtl(t);
  if (Array.isArray(payload.system)) for (const b of payload.system) stripTtl(b);
  if (Array.isArray(payload.messages)) {
    for (const m of payload.messages) {
      if (!m || !Array.isArray(m.content)) continue;
      for (const b of m.content) stripTtl(b);
    }
  }
  return changed;
}

// Cache-safe injection into the last user message. Anthropic's prompt
function injectIntoLastUserMessage(payload, block, marker) {
  if (!block || !Array.isArray(payload.messages)) return false;
  const lastUser = [...payload.messages].reverse().find((m) => m && m.role === 'user');
  if (!lastUser) return false;
  const note = '\n\n' + (marker ? `[${marker}]\n` : '') + block + '\n';
  if (typeof lastUser.content === 'string') {
    if (marker && lastUser.content.includes(`[${marker}]`)) return false;
    lastUser.content = lastUser.content + note;
    return true;
  }
  if (Array.isArray(lastUser.content)) {
    if (marker) {
      const dup = lastUser.content.some((b) => b && b.type === 'text' && typeof b.text === 'string' && b.text.includes(`[${marker}]`));
      if (dup) return false;
    }
    lastUser.content.push({ type: 'text', text: note });
    return true;
  }
  lastUser.content = [{ type: 'text', text: note }];
  return true;
}

function injectIntoSystem(payload, block, marker = 'HME Jurisdiction Context (proxy-injected)') {
  if (!block) return false;
  if (typeof payload.system === 'string') {
    if (payload.system.includes(marker)) return false;
    payload.system = payload.system + block;
    return true;
  }
  if (Array.isArray(payload.system)) {
    const already = payload.system.some((b) => {
      const t = typeof b === 'string' ? b : b && b.text;
      return typeof t === 'string' && t.includes(marker);
    });
    if (already) return false;
    payload.system.push({ type: 'text', text: block });
    return true;
  }
  if (payload.system == null) {
    payload.system = block;
    return true;
  }
  return false;
}

const jurisdiction = require('./context_jurisdiction');
const status = require('./context_status');

module.exports = {
  shouldInject,
  buildStatusContext: status.buildStatusContext,
  consumeStatusContext: status.consumeStatusContext,
  buildJurisdictionContext: jurisdiction.buildJurisdictionContext,
  injectIntoSystem,
  injectIntoLastUserMessage,
  stripSystemCacheControl,
  normalizeCacheControlTtls,
  isJurisdictionFile: jurisdiction.isJurisdictionFile,
  openHypothesesFor: jurisdiction.openHypothesesFor,
  biasBoundsFor: jurisdiction.biasBoundsFor,
  driftFor: jurisdiction.driftFor,
  // exported for test-proxy compatibility
  coherenceStatusLine: status.coherenceStatusLine,
  recentLifesaverErrors: status.recentLifesaverErrors,
  recentActivity: status.recentActivity,
  recentGroundTruth: status.recentGroundTruth,
  tailFileLines: status.tailFileLines,
};
