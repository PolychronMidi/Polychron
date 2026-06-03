'use strict';
// Final outbound context-budget gate. The single invariant that holds no matter
// WHY a payload is over-window (OmniRoute swap to a smaller-context target,

const fs = require('fs');
const path = require('path');
const { emit, PROJECT_ROOT } = require('./shared');
const { compactLargeInteractiveAnthropicPayload } = require('./hme_proxy_request_mutation');
const { submitCcCompactOnce } = require('./cc_control');
const { inputBudgetFor, estimateTokens } = require('./context_pressure');

// Estimate the final outbound input size of `payload` (post-mutation) via the
// shared conservative pressure model -- one estimator for every gate.
function estimateInputTokens(payload, env, modelId = '') {
  return estimateTokens(payload, env || process.env, PROJECT_ROOT, modelId);
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

  const budget = budgetFor(modelId);
  let tokens = estimate(payload, env, modelId);
  if (budget <= 0 || tokens <= budget) {
    return { ok: true, action: 'fit', model: modelId, tokens, budget };
  }
  // Tier 1: compact again to fit (cheapest; preserves the chosen model).
  try { compact(payload); } catch (_e) { /* silent-ok: compaction best-effort */ }
  tokens = estimate(payload, env, modelId);
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

// Caller-facing wrapper: run the gate against a request about to go upstream.
// Mutates `payload` in place (compaction/reroute) and, on an unrecoverable
// over-window verdict, writes the 413 refusal to `clientRes`. Returns
function applyOutboundContextGate({
  payload, isAnthropic, isInteractivePath, isOmniRouteSwap,
  swapModel, swapChain, outBody, sessionForTelemetry, clientRes, clientReq,
  projectRoot = PROJECT_ROOT,
  compactSubmitter = submitCcCompactOnce,
}) {
  let nextOutBody = outBody;
  let nextSwapModel = swapModel;
  if (!(isAnthropic && isInteractivePath && payload && Array.isArray(payload.messages))) {
    return { ended: false, outBody: nextOutBody, swapModel: nextSwapModel };
  }
  const gateModel = isOmniRouteSwap ? swapModel : (payload.model || '');
  const verdict = evaluateOutbound({ payload, modelId: gateModel, swapChain });
  if (verdict.action === 'compacted') {
    nextOutBody = Buffer.from(JSON.stringify(payload), 'utf8');
    emit({ event: 'outbound_gate_compacted', session: sessionForTelemetry, model: gateModel, tokens: verdict.tokens, budget: verdict.budget });
  } else if (verdict.action === 'rerouted') {
    // OmniRoute swap targets share one upstream host; reroute = rewrite the model
    // string + re-serialize. payload.model is `provider/model`.
    const newModel = verdict.reroute.api_model || verdict.reroute.id;
    if (isOmniRouteSwap && typeof payload.model === 'string' && payload.model.includes('/')) {
      payload.model = `${payload.model.split('/')[0]}/${newModel}`;
    } else {
      payload.model = newModel;
    }
    nextSwapModel = newModel;
    nextOutBody = Buffer.from(JSON.stringify(payload), 'utf8');
    emit({ event: 'outbound_gate_rerouted', session: sessionForTelemetry, from: gateModel, to: newModel, tokens: verdict.tokens });
  } else if (!verdict.ok) {
    // Local preflight refusal -- NOT an upstream failure, so the caller must not
    // touch recordUpstreamFailure (that arms the emergency circuit breaker).
    const reason = `UPSTREAM_PREFLIGHT_OVER_WINDOW: est ${verdict.tokens} input tokens > route budget ${verdict.budget} for ${verdict.model}; compaction and reroute exhausted. Refusing to ship a known-over-window request.`;
    const isPreflightSmoke = clientReq && clientReq.headers && clientReq.headers['x-hme-preflight-smoke'] === '1';
    if (!isPreflightSmoke) {
      let compactResult = null;
      try {
        compactResult = compactSubmitter(projectRoot);
      } catch (err) {
        compactResult = { submitted: false, reason: 'error', error: err && err.message ? err.message : String(err) };
      }
      try {
        fs.appendFileSync(path.join(projectRoot, 'log', 'hme-errors.log'),
          `[${new Date().toISOString()}] [outbound-gate] ${reason} cc_compact=${compactResult && compactResult.submitted ? 'submitted' : (compactResult && compactResult.reason) || 'unavailable'}\n`);
      } catch (_e) { /* silent-ok: error-log surfacing is best-effort */ }
      emit({ event: 'outbound_gate_over_window', session: sessionForTelemetry, model: verdict.model, tokens: verdict.tokens, budget: verdict.budget });
      emit({ event: 'outbound_gate_compact_requested', session: sessionForTelemetry, model: verdict.model, delivered: Boolean(compactResult && compactResult.submitted), reason: compactResult && compactResult.reason, error: compactResult && compactResult.error });
    }
    clientRes.writeHead(413, { 'Content-Type': 'application/json' });
    clientRes.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: reason } }));
    return { ended: true, outBody: nextOutBody, swapModel: nextSwapModel };
  }
  return { ended: false, outBody: nextOutBody, swapModel: nextSwapModel };
}

module.exports = { evaluateOutbound, applyOutboundContextGate, inputBudgetFor, estimateInputTokens, pickLargerRoute };
