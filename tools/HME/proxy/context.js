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

// Promote every cache_control breakpoint in payload.tools and payload.system
// to ttl='1h'. Anthropic's order rule is "no ttl='1h' breakpoint may come
// after a ttl='5m' breakpoint" across processing-order tools->system->messages.
// Claude Code stamps the user prompt's final block with ttl='1h', so any
// 5m (or unspecified-ttl, which defaults to 5m) marker on a tool or system
// block before it triggers a 400. Tools and system are stable across a
// session; promoting them to 1h is safe and eliminates the ordering
// hazard at the source. Messages are left alone -- Claude Code owns those.
function normalizeCacheControlTtls(payload) {
  let changed = 0;
  const promote = (block) => {
    if (!block || !block.cache_control) return;
    const cc = block.cache_control;
    if (cc.type !== 'ephemeral') return;
    if (cc.ttl === '1h') return;
    cc.ttl = '1h';
    changed++;
  };
  if (Array.isArray(payload.tools)) {
    for (const t of payload.tools) promote(t);
  }
  if (Array.isArray(payload.system)) {
    for (const b of payload.system) promote(b);
  }
  return changed;
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
