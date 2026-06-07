'use strict';

const fs = require('fs');
const path = require('path');
const { shrinkForPassthrough } = require('./passthrough_compact');
const { pruneWithOmoSync } = require('../omo_bridge/pruning_adapter');
const { PROJECT_ROOT } = require('./shared');
const { loadEnv } = require('./shared/load_env');
const crossSlot = require('./shared/cross_slot_state');
const { semanticTokenEstimate, serializedBytes } = require('./context_token_estimate');

// Named self-origin LIFESAVER for "compaction ran but payload still exceeds the
// routed model's context window". Pure builder so it is testable without fs/clock;
function contextWindowOverflowAlert({ model, usedTokens, budget, afterBytes, ts }) {
  if (!budget || !(usedTokens > budget)) return '';
  return `[${ts}] [hme-proxy] LIFESAVER -- context budget: assembled payload ~${usedTokens} tokens (${afterBytes}B) still exceeds model window ${budget} for ${model || 'unknown'} AFTER emergency compaction; this turn will hit the upstream context window. Run /compact or start a fresh turn; pin interactive routing to a larger-window model.\n`;
}

const _CTX_OVERFLOW_ALERT_MIN_INTERVAL_MS = 60_000;
let _lastCtxOverflowAlertMs = 0;

function _writeContextWindowOverflowAlert({ model, usedTokens, budget, afterBytes }) {
  const now = Date.now();
  if (now - _lastCtxOverflowAlertMs < _CTX_OVERFLOW_ALERT_MIN_INTERVAL_MS) return false;
  const line = contextWindowOverflowAlert({ model, usedTokens, budget, afterBytes, ts: new Date().toISOString() });
  if (!line) return false;
  _lastCtxOverflowAlertMs = now;
  try {
    const log = path.join(PROJECT_ROOT, 'log', 'hme-errors.log');
    fs.mkdirSync(path.dirname(log), { recursive: true });
    fs.appendFileSync(log, line);
  } catch (_e) { /* best effort: an alert sink must never break the request path */ }
  return true;
}

// Lazy-loaded model context budget registry.
// Reloads when the source file mtime changes (no daemon restart needed after sync).
let _modelCtxRegistry = { mtimeMs: 0, map: new Map() };

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function inputBudget(model) {
  const ctx = positiveNumber(model.context_length);
  if (ctx) return ctx;
  const input = positiveNumber(model.max_input_tokens);
  const output = positiveNumber(model.max_output_tokens);
  return input + output;
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

// modelInputBudget returns the model's full context-window budget, 0 when
// unknown (callers MUST treat 0 as "do not gate"). Delegates to the single
// canonical resolver in context_pressure so the gate budget can never drift
function modelInputBudget(modelId) {
  return require('./context_pressure').inputBudgetFor(modelId);
}

function _ensureProcessEnvLoaded() {
  loadEnv(path.resolve(__dirname, '..', '..', '..', '.env'));
}

function _envValue(env, key) {
  const value = env[key];
  if (value === undefined || value === '') {
    throw new Error(`missing required environment key ${key}; declare it in root .env`);
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

function _scaledInt(base, ratio, floor) {
  return Math.max(floor, Math.floor(Number(base) * ratio));
}

function _clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function _compactPressureForFraction({ usedFraction, startFraction }) {
  if (!Number.isFinite(usedFraction) || !Number.isFinite(startFraction)) return 0;
  if (usedFraction <= startFraction) return 0;
  const span = Math.max(0.001, 1 - startFraction);
  const x = _clamp01((usedFraction - startFraction) / span);
  // Continuous-variable transmission: barely engage just above the high-water
  // point, then rise sharply near a full context window.
  const exponent = 4;
  return (Math.exp(exponent * x) - 1) / (Math.exp(exponent) - 1);
}

function _cvtScaledCompactionKnobs({ pressure, keepMin, staleToolKeepTurns, toolResultByteFloor }) {
  if (pressure <= 0) return {};
  const p = _clamp01(pressure);
  return {
    keepMin: _scaledInt(keepMin, 1 - (0.70 * p), 4),
    maxToolResultAge: _scaledInt(staleToolKeepTurns, 1 - (0.75 * p), 1),
    toolResultByteFloor: _scaledInt(toolResultByteFloor, 1 - (0.75 * p), 512),
    compactionKnobBaselines: {
      keepMin,
      staleToolKeepTurns,
      toolResultByteFloor,
    },
  };
}

function parseProxyContextEnv(env = process.env) {
  if (env === process.env) _ensureProcessEnvLoaded();
  return {
    passthroughCompactBytes: _envPositiveInt(env, 'HME_PROXY_COMPACT_BYTES'),
    keepMin: _envPositiveInt(env, 'HME_PROXY_COMPACT_KEEP_MIN'),
    staleToolKeepTurns: _envPositiveInt(env, 'HME_PROXY_STALE_TOOL_KEEP_TURNS'),
    toolResultByteFloor: _envPositiveInt(env, 'HME_PROXY_COMPACT_TOOL_RESULT_BYTE_FLOOR'),
    contextPreflightFraction: _envPositiveNumber(env, 'HME_PROXY_CONTEXT_PREFLIGHT_FRACTION'),
    contextSignalRemainingFraction: _envPositiveNumber(env, 'HME_PROXY_CONTEXT_SIGNAL_REMAINING_FRACTION'),
    contextBytesPerTokenEst: _envPositiveNumber(env, 'HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST'),
    compactStartFraction: _envPositiveNumber(env, 'HME_PROXY_COMPACT_START_FRACTION'),
    compactGear1End: _envPositiveNumber(env, 'HME_PROXY_COMPACT_GEAR1_END'),
    compactGear2End: _envPositiveNumber(env, 'HME_PROXY_COMPACT_GEAR2_END'),
    compactGear1Target: _envPositiveNumber(env, 'HME_PROXY_COMPACT_GEAR1_TARGET'),
    compactGear2Target: _envPositiveNumber(env, 'HME_PROXY_COMPACT_GEAR2_TARGET'),
    compactGear3Target: _envPositiveNumber(env, 'HME_PROXY_COMPACT_GEAR3_TARGET'),
    compactMaxReliefFraction: _envPositiveNumber(env, 'HME_PROXY_COMPACT_MAX_RELIEF_FRACTION'),
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
    toolResultByteFloor,
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
  // Cross-slot rate-limit state: each slot reads the shared file before deciding
  // whether to back off, and writes after each 429 increment so the sibling slot
  const SLOT_LABEL = process.env.HME_PROXY_SLOT || 'single';
  let consecutive429s = (crossSlot.readRateLimitState().consecutive_429s || 0);
  let lastPayloadBytes = 0;
  let lastCompactDecisionKey = '';

  function _writeBackoff() {
    crossSlot.writeRateLimitState({
      consecutive_429s: consecutive429s,
      last_429_ts: Date.now(),
      last_slot: SLOT_LABEL,
    });
  }

  function _refreshBackoffFromDisk() {
    const disk = crossSlot.readRateLimitState();
    const diskN = Number(disk.consecutive_429s || 0);
    if (diskN > consecutive429s) consecutive429s = diskN;
  }

  function planForUsage({ usedTokens, budgetTokens }) {
    if (!budgetTokens || budgetTokens <= 0) return { threshold: Infinity, maxTier: 0, pressure: 0 };
    const usedFraction = usedTokens / budgetTokens;
    const pressure = _compactPressureForFraction({ usedFraction, startFraction: compactStartFraction });
    if (pressure <= 0) return { threshold: Infinity, maxTier: 0, pressure: 0 };
    const floorTargetFraction = Math.min(compactStartFraction, compactGear1Target || compactStartFraction);
    const targetFraction = Math.max(
      floorTargetFraction,
      usedFraction - ((usedFraction - floorTargetFraction) * pressure),
    );
    const targetTokens = Math.max(1, Math.floor(budgetTokens * targetFraction));
    const threshold = Math.max(1, Math.floor(targetTokens * contextBytesPerTokenEst));
    // Continuous-variable transmission: knobs derive from the env baseline and a
    // smooth pressure scalar. They never ratchet from prior effective values.
    return {
      threshold,
      targetTokens,
      pressure,
      maxTier: 1 + (2 * pressure),
      allowSummary: pressure >= 0.20,
      allowMessageDrop: pressure >= 0.55 || usedFraction >= 1,
      ..._cvtScaledCompactionKnobs({ pressure, keepMin, staleToolKeepTurns, toolResultByteFloor }),
    };
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
    const statusline = statuslineContextUsage();
    const fallbackBudget = lastInputTokensLimit || statusline.size || 0;
    if (!payload || typeof payload !== 'object') return { model: '', budget: fallbackBudget };
    const candidates = [payload.model, payload.original_model, payload.target_model].filter(Boolean).map(String);
    for (const id of candidates) {
      const ctx = resolveModelCtx(id);
      if (ctx && ctx !== 1000000) return { model: id, budget: ctx };
    }
    return { model: candidates[0] || '', budget: fallbackBudget };
  }

  function compactDecisionTelemetry({ payload, bytes, usedTokens, budgetTokens, plan, cappedByBytes, telemetryLimited }) {
    if ((plan.maxTier || 0) <= 0 && !compactTrace) return;
    const model = payload && payload.model || '';
    const frac = budgetTokens > 0 ? usedTokens / budgetTokens : 0;
    const key = [model, usedTokens, budgetTokens || 0, plan.pressure || 0, Number.isFinite(plan.threshold) ? plan.threshold : 'inf', cappedByBytes ? 1 : 0, telemetryLimited ? 1 : 0].join(':');
    if (key === lastCompactDecisionKey) return;
    lastCompactDecisionKey = key;
    const pct = budgetTokens > 0 ? `${(frac * 100).toFixed(1)}%` : 'unknown';
    const threshold = Number.isFinite(plan.threshold) ? `${plan.threshold}B` : 'none';
    const pressure = Number.isFinite(plan.pressure) ? plan.pressure.toFixed(3) : '0.000';
    const severity = Number.isFinite(plan.maxTier) ? plan.maxTier.toFixed(2) : '0.00';
    console.error(`[hme-proxy] compact-decision model=${model || 'unknown'} bytes=${bytes} est_tokens=${usedTokens} budget=${budgetTokens || 'unknown'} used=${pct} pressure=${pressure} severity=${severity} threshold=${threshold} summary=${plan.allowSummary ? 'yes' : 'no'} drop=${plan.allowMessageDrop ? 'yes' : 'no'} explicit_byte_cap=${cappedByBytes ? 'yes' : 'no'} telemetry_limited=${telemetryLimited ? 'yes' : 'no'}`);
  }

  function compactPressureTokens(payload, bytes, opts = {}) {
    if (!opts.ignoreStatusline) {
      const statusline = statuslineContextUsage();
      if (statusline.used > 0) return { usedTokens: statusline.used, source: 'statusline' };
    }
    if (payload) {
      const { calibratedFactors } = require('./context_calibration');
      const model = String(opts.model || payload.model || payload.original_model || payload.target_model || '');
      const prior = semanticTokenEstimate(payload, process.env, null);
      const calibrated = semanticTokenEstimate(payload, process.env, calibratedFactors(process.env, PROJECT_ROOT, model));
      return { usedTokens: Math.max(prior, calibrated), source: 'semantic' };
    }
    return { usedTokens: Math.ceil(bytes / contextBytesPerTokenEst), source: 'bytes' };
  }

  function effectiveCompactThreshold(payload = null) {
    const bytes = payload ? serializedBytes(payload) : lastPayloadBytes;
    const pressure = compactPressureTokens(payload, bytes);
    const usedTokens = pressure.usedTokens;
    const modelInfo = payloadModelInfo(payload);
    const budgetTokens = modelInfo.budget;
    let plan = planForUsage({ usedTokens, budgetTokens, fallbackBytes: passthroughCompactBytes });
    let cappedByBytes = false;
    const telemetryLimited = false;
    if (compactBytesExplicit && plan.maxTier > 0 && passthroughCompactBytes < plan.threshold) {
      plan = { ...plan, threshold: passthroughCompactBytes };
      cappedByBytes = true;
    }
    if (consecutive429s > 0) {
      const cap = Math.max(1, Math.floor((budgetTokens || 128000) * 0.5 * contextBytesPerTokenEst / Math.pow(2, consecutive429s)));
      plan = { ...plan, threshold: Math.min(plan.threshold, cap), pressure: Math.max(plan.pressure || 0, 1), maxTier: Math.max(plan.maxTier || 0, 3), allowSummary: true, allowMessageDrop: true };
      cappedByBytes = true;
    }
    compactDecisionTelemetry({ payload: payload && { ...payload, model: payload.model || modelInfo.model }, bytes, usedTokens, budgetTokens, plan, cappedByBytes, telemetryLimited });
    return plan;
  }

  function statuslineContextUsage() {
    const { statuslineUsage } = require('./context_pressure');
    const sl = statuslineUsage(process.env, PROJECT_ROOT);
    const registrySize = sl.modelId ? resolveModelCtx(sl.modelId) : 0;
    const size = (registrySize && registrySize !== 1000000 ? registrySize : 0) || sl.size;
    return { used: sl.used, size };
  }

  function omniContextThresholdBytes(swapModel) {
    const budget = resolveModelCtx(String(swapModel || ''));
    const startTokens = Math.floor(budget * compactStartFraction);
    const preflightBytes = Math.floor(budget * contextPreflightFraction * contextBytesPerTokenEst);
    const startBytes = Math.floor(startTokens * contextBytesPerTokenEst);
    return Math.max(preflightBytes, startBytes);
  }

  function injectContextHeader(headers, _swapModel) {
    const { used, size } = statuslineContextUsage();
    if (!used || !size) return;
    // Always normalize Claude Code's view of context budget using statusline
    // ground truth. Upstream Anthropic rate-limit headers
    const remaining = Math.max(0, size - used);
    headers['anthropic-ratelimit-input-tokens-limit'] = String(size);
    headers['anthropic-ratelimit-input-tokens-remaining'] = String(remaining);
    delete headers['anthropic-ratelimit-input-tokens-reset'];
    // Telemetry sink read by event_kernel/statusline.js LIFESAVER fail-fast.
    // Absence or staleness of this file signals the autocompact widget is
    try {
      const sink = path.join(PROJECT_ROOT, 'tools', 'HME', 'runtime', 'proxy-context-norm.json');
      fs.writeFileSync(sink, JSON.stringify({
        ts_ms: Date.now(),
        pid: process.pid,
        used,
        size,
        remaining,
      }));
    } catch (_e) { /* best effort */ }
    if ((used / size) >= compactStartFraction
        && remaining < size * contextSignalRemainingFraction) {
      console.error(`[hme-proxy] context signal: ~${used}/${size} Claude-window tokens (${remaining} remaining) -> triggering /compact`);
    }
  }

  function shrinkForProxyPassthrough(payload) {
    const plan = effectiveCompactThreshold(payload);
    if ((plan.maxTier || 0) <= 0) return 0;
    const model = payload && (payload.model || payload.target_model || payload.original_model) || '';
    if (omoPruningBridge) pruneWithOmoSync(payload, {
      route: 'proxy-passthrough',
      model,
      protectedTools: ['Read', 'Edit', 'Write', 'Bash', 'TodoWrite'],
    });
    return shrinkForPassthrough(payload, {
      effectiveThreshold: () => plan,
      keepMin: plan.keepMin,
      maxToolResultAge: plan.maxToolResultAge,
      toolResultByteFloor: plan.toolResultByteFloor,
      microcompactStop: ({ payload: p }) => {
        const now = compactPressureTokens(p, serializedBytes(p), { ignoreStatusline: true, model });
        return now.usedTokens <= plan.targetTokens;
      },
      tokenEstimator: (p) => compactPressureTokens(p, serializedBytes(p), { ignoreStatusline: true, model }).usedTokens,
      route: 'proxy-passthrough',
      model,
      projectRoot: PROJECT_ROOT,
    });
  }

  function shrinkForOmniContext(payload, swapModel) {
    const model = String(swapModel || '');
    const budget = resolveModelCtx(model);
    const before = serializedBytes(payload);
    const pressure = compactPressureTokens(payload, before, { ignoreStatusline: true, model });
    const usedTokens = pressure.usedTokens;
    const plan = planForUsage({ usedTokens, budgetTokens: budget });
    if (!budget || plan.maxTier <= 0) return 0;
    if (omoPruningBridge) pruneWithOmoSync(payload, {
      route: 'omni-context',
      model,
      protectedTools: ['Read', 'Edit', 'Write', 'Bash', 'TodoWrite'],
    });
    const afterPruneBytes = serializedBytes(payload);
    const prunePressure = compactPressureTokens(payload, afterPruneBytes, { ignoreStatusline: true, model });
    const prunePlan = planForUsage({ usedTokens: prunePressure.usedTokens, budgetTokens: budget });
    if (prunePlan.maxTier <= 0 || afterPruneBytes <= prunePlan.threshold) return 0;
    const changed = shrinkForPassthrough(payload, {
      effectiveThreshold: () => ({ ...prunePlan, beforeTokens: prunePressure.usedTokens }),
      keepMin: prunePlan.keepMin,
      maxToolResultAge: prunePlan.maxToolResultAge,
      toolResultByteFloor: prunePlan.toolResultByteFloor,
      microcompactStop: ({ payload: p }) => {
        const pressureNow = compactPressureTokens(p, serializedBytes(p), { ignoreStatusline: true, model });
        return pressureNow.usedTokens <= prunePlan.targetTokens;
      },
      tokenEstimator: (p) => compactPressureTokens(p, serializedBytes(p), { ignoreStatusline: true, model }).usedTokens,
      env: { ...process.env, HME_PROXY_LOCAL_SUMMARY: omniLocalSummary },
      log: (msg) => console.error(`[hme-proxy] omni-context ${msg}`),
      route: 'omni-context',
      model,
      projectRoot: PROJECT_ROOT,
    });
    const after = serializedBytes(payload);
    const afterPressure = compactPressureTokens(payload, after, { ignoreStatusline: true, model });
    console.error(`[hme-proxy] omni-context preflight: ${before}B -> ${after}B threshold=${Number.isFinite(prunePlan.threshold) ? prunePlan.threshold : 'none'}B tier=${prunePlan.maxTier} model=${model} pressure=${afterPressure.usedTokens}/${budget} pressure_source=${afterPressure.source} changed=${changed}`);
    // Compaction ran but the payload still exceeds the model window -> this turn
    // will 200 upstream. Surface a named self-origin LIFESAVER instead of staying silent
    _writeContextWindowOverflowAlert({ model, usedTokens: afterPressure.usedTokens, budget, afterBytes: after });
    return changed;
  }

  return {
    effectiveCompactThreshold,
    shrinkForPassthrough: shrinkForProxyPassthrough,
    shrinkForContext: shrinkForOmniContext,
    omniContextThresholdBytes,
    injectContextHeader,
    getConsecutive429s: () => { _refreshBackoffFromDisk(); return consecutive429s; },
    setConsecutive429s: (n) => { consecutive429s = n; _writeBackoff(); },
    incConsecutive429s: () => { _refreshBackoffFromDisk(); consecutive429s = Math.min(consecutive429s + 1, 4); _writeBackoff(); return consecutive429s; },
    getLastInputTokensRemaining: () => lastInputTokensRemaining,
    setLastInputTokensRemaining: (n) => { lastInputTokensRemaining = n; },
    getLastInputTokensLimit: () => lastInputTokensLimit,
    setLastInputTokensLimit: (n) => { lastInputTokensLimit = n; },
    setLastPayloadBytes: (n) => { lastPayloadBytes = n; },
  };
}

module.exports = { createContextBudget, parseProxyContextEnv, inputBudget, modelInputBudget, contextWindowOverflowAlert };
