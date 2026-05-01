'use strict';
// Jurisdiction context + session-status injection orchestrator.
// Heavy lifting lives in context_jurisdiction.js / context_status.js.

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./shared');
const METRICS_DIR = process.env.METRICS_DIR || path.join(PROJECT_ROOT, 'output', 'metrics');

const INJECT = (process.env.HME_PROXY_INJECT ?? '1') !== '0';
const REFRESH_INTERVAL_MS = 60_000;

const COHERENCE_BUDGET_PATH = path.join(METRICS_DIR, 'hme-coherence-budget.json');
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
  buildJurisdictionContext: jurisdiction.buildJurisdictionContext,
  injectIntoSystem,
  stripSystemCacheControl,
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
