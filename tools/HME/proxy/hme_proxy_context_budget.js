'use strict';

const fs = require('fs');
const path = require('path');
const { shrinkForPassthrough } = require('./passthrough_compact');
const { PROJECT_ROOT } = require('./shared');

// Lazy-loaded model context budget registry.
// Reloads when the source file mtime changes (no daemon restart needed after sync).
let _modelCtxRegistry = { mtimeMs: 0, map: new Map() };

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function inputBudget(model) {
  const input = positiveNumber(model.max_input_tokens);
  if (input) return input;
  const ctx = positiveNumber(model.context_length);
  const output = positiveNumber(model.max_output_tokens);
  if (ctx && output && ctx > output) return ctx - output;
  return ctx;
}
function loadModelCtxRegistry() {
  const modelsPath = path.join(PROJECT_ROOT, 'config', 'models.json');
  let stat; try { stat = fs.statSync(modelsPath); } catch { return _modelCtxRegistry.map; }
  if (stat.mtimeMs === _modelCtxRegistry.mtimeMs) return _modelCtxRegistry.map;
  const text = fs.readFileSync(modelsPath, 'utf8');
  // Strip // line + /* */ block comments before JSON.parse (mirrors jsonc.py).
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  let cfg; try { cfg = JSON.parse(stripped); } catch { return _modelCtxRegistry.map; }
  const map = new Map();
  for (const tier of Object.values(cfg.tiers || {})) {
    for (const m of tier.models || []) {
      const budget = inputBudget(m);
      if (budget > 0 && m.id) map.set(String(m.id), budget);
      if (budget > 0 && m.api_model) map.set(String(m.api_model), budget);
    }
  }
  _modelCtxRegistry = { mtimeMs: stat.mtimeMs, map };
  return map;
}

function envNumber(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function createContextBudget() {
  const passthroughCompactBytes = parseInt(process.env.HME_PROXY_COMPACT_BYTES || '250000', 10);
  const compactBytesExplicit = process.env.HME_PROXY_COMPACT_BYTES != null
    && process.env.HME_PROXY_COMPACT_BYTES !== '';
  const keepMin = parseInt(process.env.HME_PROXY_COMPACT_KEEP_MIN || '100', 10);
  const staleToolKeepTurns = parseInt(process.env.HME_PROXY_STALE_TOOL_KEEP_TURNS || String(keepMin), 10);
  let lastInputTokensRemaining = null;
  let lastInputTokensLimit = null;
  let consecutive429s = 0;
  let lastPayloadBytes = 0;
  const bytesPerTokenEst = envNumber('HME_PROXY_BYTES_PER_TOKEN_EST', 3.5);
  const modelContextFraction = envNumber('HME_PROXY_CONTEXT_FRACTION', 0.90);
  const contextPreflightFraction = envNumber('HME_PROXY_CONTEXT_PREFLIGHT_FRACTION', modelContextFraction);
  const contextSignalRemainingFraction = envNumber('HME_PROXY_CONTEXT_SIGNAL_REMAINING_FRACTION', 0.25);
  const contextBytesPerTokenEst = envNumber('HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST', 2.2);
  const compactStartFraction = envNumber('HME_PROXY_COMPACT_START_FRACTION', 0.80);
  const compactGear1End = envNumber('HME_PROXY_COMPACT_GEAR1_END', 0.90);
  const compactGear2End = envNumber('HME_PROXY_COMPACT_GEAR2_END', 0.97);
  const compactGear1Target = envNumber('HME_PROXY_COMPACT_GEAR1_TARGET', 0.80);
  const compactGear2Target = envNumber('HME_PROXY_COMPACT_GEAR2_TARGET', 0.90);
  const compactGear3Target = envNumber('HME_PROXY_COMPACT_GEAR3_TARGET', 0.97);
  let lastCompactDecisionKey = '';

  function pressureForFraction(usedFraction) {
    if (usedFraction < compactStartFraction) return 0;
    if (usedFraction < compactGear1End) return 1;
    if (usedFraction < compactGear2End) return 2;
    return 3;
  }

  function planForUsage({ usedTokens, budgetTokens, fallbackBytes }) {
    if (!budgetTokens || budgetTokens <= 0) return { threshold: fallbackBytes, maxTier: 3 };
    const usedFraction = usedTokens / budgetTokens;
    const gear = pressureForFraction(usedFraction);
    if (gear <= 0) return { threshold: Infinity, maxTier: 0 };
    const targetFraction = gear === 1 ? compactGear1Target : (gear === 2 ? compactGear2Target : compactGear3Target);
    const threshold = Math.max(1, Math.floor(budgetTokens * targetFraction * contextBytesPerTokenEst));
    const staleHorizon = gear === 1 ? keepMin * 4 : (gear === 2 ? keepMin * 2 : keepMin);
    const floor = gear === 1 ? 50000 : (gear === 2 ? 15000 : 2000);
    return { threshold, maxTier: gear, maxToolResultAge: staleHorizon, toolResultByteFloor: floor };
  }

  function resolveModelCtx(modelId) {
    // Budget prefers sanitized max_input_tokens.
    const id = String(modelId || '');
    const reg = loadModelCtxRegistry();
    if (reg.has(id)) return reg.get(id);
    for (const [k, v] of reg) if (id.includes(k)) return v;
    return 1000000;
  }

  function payloadModelInfo(payload) {
    if (!payload || typeof payload !== 'object') return { model: '', budget: 0 };
    const candidates = [payload.model, payload.original_model, payload.target_model].filter(Boolean).map(String);
    for (const id of candidates) {
      const ctx = resolveModelCtx(id);
      if (ctx && ctx !== 1000000) return { model: id, budget: ctx };
    }
    return { model: candidates[0] || '', budget: 0 };
  }

  function compactDecisionTelemetry({ payload, bytes, usedTokens, budgetTokens, plan, cappedByBytes, telemetryLimited }) {
    const model = payload && payload.model || '';
    const frac = budgetTokens > 0 ? usedTokens / budgetTokens : 0;
    const key = [model, usedTokens, budgetTokens || 0, plan.maxTier || 0, Number.isFinite(plan.threshold) ? plan.threshold : 'inf', cappedByBytes ? 1 : 0, telemetryLimited ? 1 : 0].join(':');
    if (key === lastCompactDecisionKey) return;
    lastCompactDecisionKey = key;
    const pct = budgetTokens > 0 ? `${(frac * 100).toFixed(1)}%` : 'unknown';
    const threshold = Number.isFinite(plan.threshold) ? `${plan.threshold}B` : 'none';
    console.error(`[hme-proxy] compact-decision model=${model || 'unknown'} bytes=${bytes} est_tokens=${usedTokens} budget=${budgetTokens || 'unknown'} used=${pct} gear=${plan.maxTier || 0} threshold=${threshold} explicit_byte_cap=${cappedByBytes ? 'yes' : 'no'} telemetry_limited=${telemetryLimited ? 'yes' : 'no'}`);
  }

  function effectiveCompactThreshold(payload = null) {
    const bytes = payload ? Buffer.byteLength(JSON.stringify(payload), 'utf8') : lastPayloadBytes;
    const usedTokens = Math.ceil(bytes / contextBytesPerTokenEst);
    let budgetTokens = lastInputTokensLimit || payloadModelBudget(payload);
    if ((!budgetTokens || budgetTokens <= 0) && lastInputTokensRemaining != null) {
      budgetTokens = usedTokens + lastInputTokensRemaining;
    }
    let plan = planForUsage({ usedTokens, budgetTokens, fallbackBytes: passthroughCompactBytes });
    if (compactBytesExplicit && plan.maxTier > 0) plan = { ...plan, threshold: Math.min(plan.threshold, passthroughCompactBytes) };
    if (lastInputTokensRemaining != null && lastInputTokensRemaining >= 0 && budgetTokens > 0) {
      const telemetryUsed = Math.max(0, budgetTokens - lastInputTokensRemaining);
      const telemetryPlan = planForUsage({ usedTokens: telemetryUsed, budgetTokens, fallbackBytes: passthroughCompactBytes });
      if (telemetryPlan.maxTier > plan.maxTier) plan = telemetryPlan;
      else if (telemetryPlan.maxTier === plan.maxTier && telemetryPlan.maxTier > 0) plan = { ...plan, threshold: Math.min(plan.threshold, telemetryPlan.threshold) };
    }
    if (consecutive429s > 0) {
      const cap = Math.max(1, Math.floor((budgetTokens || 128000) * 0.5 * contextBytesPerTokenEst / Math.pow(2, consecutive429s)));
      plan = { ...plan, threshold: Math.min(plan.threshold, cap), maxTier: Math.max(plan.maxTier, 3) };
    }
    return plan;
  }

  function estimatedContextTokens(bytes) { return Math.ceil(bytes / contextBytesPerTokenEst); }
  function omniContextThresholdBytes(swapModel) { return Math.floor(resolveModelCtx(String(swapModel || '')) * contextPreflightFraction * contextBytesPerTokenEst); }

  function injectContextHeader(headers, swapModel) {
    const ctx = resolveModelCtx(swapModel);
    const estUsed = estimatedContextTokens(lastPayloadBytes);
    const remaining = Math.max(0, ctx - estUsed);
    if (remaining < ctx * contextSignalRemainingFraction) {
      headers['anthropic-ratelimit-input-tokens-remaining'] = String(remaining);
      console.error(`[hme-proxy] context signal: ~${estUsed}/${ctx} tokens (${remaining} remaining) -> triggering /compact`);
    }
  }

  function shrinkForProxyPassthrough(payload) {
    return shrinkForPassthrough(payload, {
      effectiveThreshold: effectiveCompactThreshold,
      keepMin,
      maxToolResultAge: staleToolKeepTurns,
      projectRoot: PROJECT_ROOT,
    });
  }

  function shrinkForOmniContext(payload, swapModel) {
    const threshold = omniContextThresholdBytes(swapModel);
    const before = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    if (before <= threshold) return 0;
    const changed = shrinkForPassthrough(payload, {
      threshold,
      keepMin,
      maxToolResultAge: staleToolKeepTurns,
      env: { ...process.env, HME_PROXY_LOCAL_SUMMARY: process.env.HME_PROXY_OMNI_LOCAL_SUMMARY || process.env.HME_PROXY_LOCAL_SUMMARY || '0' },
      log: (msg) => console.error(`[hme-proxy] omni-context ${msg}`),
      projectRoot: PROJECT_ROOT,
    });
    const after = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    console.error(`[hme-proxy] omni-context preflight: ${before}B -> ${after}B threshold=${threshold}B model=${swapModel} est=${estimatedContextTokens(after)}/${resolveModelCtx(String(swapModel || ''))} tokens changed=${changed}`);
    return changed;
  }

  return {
    effectiveCompactThreshold,
    shrinkForPassthrough: shrinkForProxyPassthrough,
    shrinkForContext: shrinkForOmniContext,
    injectContextHeader,
    getConsecutive429s: () => consecutive429s,
    setConsecutive429s: (n) => { consecutive429s = n; },
    incConsecutive429s: () => { consecutive429s = Math.min(consecutive429s + 1, 4); return consecutive429s; },
    getLastInputTokensRemaining: () => lastInputTokensRemaining,
    setLastInputTokensRemaining: (n) => { lastInputTokensRemaining = n; },
    getLastInputTokensLimit: () => lastInputTokensLimit,
    setLastInputTokensLimit: (n) => { lastInputTokensLimit = n; },
    setLastPayloadBytes: (n) => { lastPayloadBytes = n; },
  };
}

module.exports = { createContextBudget, envNumber, inputBudget };
