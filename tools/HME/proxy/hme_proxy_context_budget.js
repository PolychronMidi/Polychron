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

function effectiveContextLength(model) {
  const explicit = positiveNumber(model.effective_context_length);
  if (explicit) return explicit;
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
      const eff = effectiveContextLength(m);
      if (eff > 0 && m.id) map.set(String(m.id), eff);
      if (eff > 0 && m.api_model) map.set(String(m.api_model), eff);
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
  const dynamicThresholdFloorBytes = parseInt(process.env.HME_PROXY_COMPACT_FLOOR_BYTES || '999000', 10);
  const modelContextFraction = envNumber('HME_PROXY_CONTEXT_FRACTION', 0.90);
  const contextPreflightFraction = envNumber('HME_PROXY_CONTEXT_PREFLIGHT_FRACTION', modelContextFraction);
  const contextSignalRemainingFraction = envNumber('HME_PROXY_CONTEXT_SIGNAL_REMAINING_FRACTION', 0.25);
  const contextBytesPerTokenEst = envNumber('HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST', 2.2);

  function effectiveCompactThreshold() {
    let ceiling;
    if (compactBytesExplicit) ceiling = passthroughCompactBytes;
    else if (lastInputTokensLimit != null && lastInputTokensLimit > 0) ceiling = Math.floor(lastInputTokensLimit * modelContextFraction * bytesPerTokenEst);
    else ceiling = passthroughCompactBytes;
    let panicCap = ceiling;
    if (consecutive429s > 0) panicCap = Math.max(dynamicThresholdFloorBytes, Math.floor(ceiling / Math.pow(2, consecutive429s)));
    let remainingCap = ceiling;
    if (lastInputTokensRemaining != null && lastInputTokensRemaining > 0) {
      const remainingFraction = Number(process.env.HME_PROXY_REMAINING_FRACTION || '0.80');
      remainingCap = Math.floor(lastInputTokensRemaining * remainingFraction * bytesPerTokenEst);
    }
    return Math.max(dynamicThresholdFloorBytes, Math.min(panicCap, remainingCap));
  }

  function resolveModelCtx(modelId) {
    // Budget uses explicit effective_context_length or context minus output cap.
    const id = String(modelId || '');
    const reg = loadModelCtxRegistry();
    if (reg.has(id)) return reg.get(id);
    for (const [k, v] of reg) if (id.includes(k)) return v;
    return 1000000;
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

module.exports = { createContextBudget, envNumber };
