'use strict';

const fs = require('fs');
const path = require('path');
const { shrinkForPassthrough } = require('./passthrough_compact');
const { pruneWithOmoSync } = require('../omo_bridge/pruning_adapter');
const { PROJECT_ROOT } = require('./shared');
const { loadEnv } = require('./shared/load_env');

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

function _ensureProcessEnvLoaded() {
  loadEnv(path.resolve(__dirname, '..', '..', '..', '.env'));
}

function _envValue(env, key) {
  const value = env[key];
  if (value === undefined || value === '') {
    throw new Error(`missing required environment key ${key}; declare it in .env and doc/templates/.env.example`);
  }
  return String(value).trim();
}

function _envPositiveNumber(env, key) {
  const raw = _envValue(env, key);
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`invalid positive numeric environment key ${key}=${JSON.stringify(raw)}`);
  return n;
}

function _envPositiveInt(env, key) {
  const raw = _envValue(env, key);
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || String(n) !== raw || n <= 0) throw new Error(`invalid positive integer environment key ${key}=${JSON.stringify(raw)}`);
  return n;
}

function _envBool(env, key) {
  const raw = _envValue(env, key).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new Error(`invalid boolean environment key ${key}=${JSON.stringify(env[key])}`);
}

function parseProxyContextEnv(env = process.env) {
  if (env === process.env) _ensureProcessEnvLoaded();
  return {
    passthroughCompactBytes: _envPositiveInt(env, 'HME_PROXY_COMPACT_BYTES'),
    keepMin: _envPositiveInt(env, 'HME_PROXY_COMPACT_KEEP_MIN'),
    staleToolKeepTurns: _envPositiveInt(env, 'HME_PROXY_STALE_TOOL_KEEP_TURNS'),
    modelContextFraction: _envPositiveNumber(env, 'HME_PROXY_CONTEXT_FRACTION'),
    contextPreflightFraction: _envPositiveNumber(env, 'HME_PROXY_CONTEXT_PREFLIGHT_FRACTION'),
    contextSignalRemainingFraction: _envPositiveNumber(env, 'HME_PROXY_CONTEXT_SIGNAL_REMAINING_FRACTION'),
    contextBytesPerTokenEst: _envPositiveNumber(env, 'HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST'),
    compactStartFraction: _envPositiveNumber(env, 'HME_PROXY_COMPACT_START_FRACTION'),
    compactGear1End: _envPositiveNumber(env, 'HME_PROXY_COMPACT_GEAR1_END'),
    compactGear2End: _envPositiveNumber(env, 'HME_PROXY_COMPACT_GEAR2_END'),
    compactGear1Target: _envPositiveNumber(env, 'HME_PROXY_COMPACT_GEAR1_TARGET'),
    compactGear2Target: _envPositiveNumber(env, 'HME_PROXY_COMPACT_GEAR2_TARGET'),
    compactGear3Target: _envPositiveNumber(env, 'HME_PROXY_COMPACT_GEAR3_TARGET'),
    compactTrace: _envBool(env, 'HME_PROXY_COMPACT_TRACE'),
    omoPruningBridge: _envBool(env, 'HME_OMO_PRUNING_BRIDGE'),
    localSummary: _envBool(env, 'HME_PROXY_LOCAL_SUMMARY') ? '1' : '0',
    omniLocalSummary: _envBool(env, 'HME_PROXY_OMNI_LOCAL_SUMMARY') ? '1' : '0',
  };
}

function createContextBudget() {
  const cfg = parseProxyContextEnv();
  const {
    passthroughCompactBytes,
    keepMin,
    staleToolKeepTurns,
    contextPreflightFraction,
    contextSignalRemainingFraction,
    contextBytesPerTokenEst,
    compactStartFraction,
    compactGear1End,
    compactGear2End,
    compactGear1Target,
    compactGear2Target,
    compactGear3Target,
    compactTrace,
    omoPruningBridge,
    omniLocalSummary,
  } = cfg;
  const compactBytesExplicit = true;
  let lastInputTokensRemaining = null;
  let lastInputTokensLimit = null;
  let consecutive429s = 0;
  let lastPayloadBytes = 0;
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
    const floor = gear === 1 ? 200000 : (gear === 2 ? 125000 : 75000);
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
    if ((plan.maxTier || 0) <= 0 && !compactTrace) return;
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
    const modelInfo = payloadModelInfo(payload);
    let budgetTokens = lastInputTokensLimit || modelInfo.budget;
    if ((!budgetTokens || budgetTokens <= 0) && lastInputTokensRemaining != null) {
      budgetTokens = usedTokens + lastInputTokensRemaining;
    }
    let plan = planForUsage({ usedTokens, budgetTokens, fallbackBytes: passthroughCompactBytes });
    let cappedByBytes = false;
    let telemetryLimited = false;
    if (compactBytesExplicit && plan.maxTier > 0 && passthroughCompactBytes < plan.threshold) {
      plan = { ...plan, threshold: passthroughCompactBytes };
      cappedByBytes = true;
    }
    if (lastInputTokensRemaining != null && lastInputTokensRemaining >= 0 && budgetTokens > 0) {
      const telemetryUsed = Math.max(0, budgetTokens - lastInputTokensRemaining);
      const telemetryPlan = planForUsage({ usedTokens: telemetryUsed, budgetTokens, fallbackBytes: passthroughCompactBytes });
      if (telemetryPlan.maxTier > plan.maxTier) {
        plan = telemetryPlan;
        telemetryLimited = true;
      } else if (telemetryPlan.maxTier === plan.maxTier && telemetryPlan.maxTier > 0 && telemetryPlan.threshold < plan.threshold) {
        plan = { ...plan, threshold: telemetryPlan.threshold };
        telemetryLimited = true;
      }
    }
    if (consecutive429s > 0) {
      const cap = Math.max(1, Math.floor((budgetTokens || 128000) * 0.5 * contextBytesPerTokenEst / Math.pow(2, consecutive429s)));
      plan = { ...plan, threshold: Math.min(plan.threshold, cap), maxTier: Math.max(plan.maxTier, 3) };
      cappedByBytes = true;
    }
    compactDecisionTelemetry({ payload: payload && { ...payload, model: payload.model || modelInfo.model }, bytes, usedTokens, budgetTokens, plan, cappedByBytes, telemetryLimited });
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
    if (omoPruningBridge) pruneWithOmoSync(payload, {
      route: 'proxy-passthrough',
      model: payload && (payload.model || payload.target_model || payload.original_model) || '',
      protectedTools: ['Read', 'Edit', 'Write', 'Bash', 'TodoWrite'],
    });
    return shrinkForPassthrough(payload, {
      effectiveThreshold: effectiveCompactThreshold,
      keepMin,
      maxToolResultAge: staleToolKeepTurns,
      route: 'proxy-passthrough',
      model: payload && (payload.model || payload.target_model || payload.original_model) || '',
      projectRoot: PROJECT_ROOT,
    });
  }

  function shrinkForOmniContext(payload, swapModel) {
    if (omoPruningBridge) pruneWithOmoSync(payload, {
      route: 'omni-context',
      model: String(swapModel || ''),
      protectedTools: ['Read', 'Edit', 'Write', 'Bash', 'TodoWrite'],
    });
    const threshold = omniContextThresholdBytes(swapModel);
    const before = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    if (before <= threshold) return 0;
    const changed = shrinkForPassthrough(payload, {
      threshold,
      keepMin,
      maxToolResultAge: staleToolKeepTurns,
      env: { ...process.env, HME_PROXY_LOCAL_SUMMARY: omniLocalSummary },
      log: (msg) => console.error(`[hme-proxy] omni-context ${msg}`),
      route: 'omni-context',
      model: String(swapModel || ''),
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
    estimatedContextTokens,
    omniContextThresholdBytes,
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

module.exports = { createContextBudget, parseProxyContextEnv, inputBudget };
