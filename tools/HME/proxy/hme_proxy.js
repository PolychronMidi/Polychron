#!/usr/bin/env node
/**
 * HME inference proxy + process supervisor.
 *
 * Thin executable wrapper. Core helpers live in hme_proxy_core.js; Claude
 * Anthropic request handling lives in hme_proxy_claude.js; OmniRoute/Codex
 * fallback helpers live in hme_proxy_codex.js.
 */

'use strict';

const http = require('http');

const { sessionKey } = require('./shared');
const {
  DEFAULT_UPSTREAM_HOST, DEFAULT_UPSTREAM_PORT, DEFAULT_UPSTREAM_TLS,
} = require('./upstream');
const { buildJurisdictionContext } = require('./context');
const { scanMessages } = require('./messages');
const { servicePort } = require('./service_registry');
const { emitStartMarker } = require('./start_marker');
const { createRouteMetrics } = require('./proxy_route_metrics');
const { shrinkForPassthrough } = require('./passthrough_compact');
const { createClaudeHandler } = require('./hme_proxy_claude');
const core = require('./hme_proxy_core');

// Self-load .env via shared helper; parent shell may not have sourced it.
(() => {
  try {
    const { loadEnv } = require('./shared/load_env');
    loadEnv(require('path').resolve(__dirname, '..', '..', '..', '.env'));
  } catch (_e) { /* fail-soft: proxy still runs without .env knobs */ }
})();

const PROXY_VERSION = (() => {
  try {
    const p = require('path').resolve(__dirname, '..', 'config', 'versions.json');
    return JSON.parse(require('fs').readFileSync(p, 'utf8')).proxy;
  } catch (_) { return 'unknown'; }
})();
const PROXY_GIT_SHA = (() => {
  try {
    const { execSync } = require('child_process');
    return execSync('git rev-parse --short HEAD', {
      cwd: require('path').resolve(__dirname, '..', '..', '..'),
      encoding: 'utf8',
      timeout: 1000,
    }).trim();
  } catch (_) { return 'unknown'; }
})();
const PROXY_STARTED_AT = new Date().toISOString();

const proxyRouteMetrics = createRouteMetrics();
const PORT = servicePort('proxy');
const SUPERVISE = (process.env.HME_PROXY_SUPERVISE ?? '1') !== '0';
const { WORKER_PORT } = require('./supervisor/children');

const middleware = require('./middleware/index');
const loadedMiddleware = middleware.loadAll();
console.log(`loaded middleware: ${loadedMiddleware.join(', ')}`);

const PASSTHROUGH_COMPACT_BYTES = parseInt(process.env.HME_PROXY_COMPACT_BYTES || '250000', 10);
const COMPACT_BYTES_EXPLICIT = process.env.HME_PROXY_COMPACT_BYTES != null
  && process.env.HME_PROXY_COMPACT_BYTES !== '';
const PASSTHROUGH_COMPACT_KEEP_MIN = parseInt(process.env.HME_PROXY_COMPACT_KEEP_MIN || '100', 10);
const STALE_TOOL_KEEP_TURNS = parseInt(
  process.env.HME_PROXY_STALE_TOOL_KEEP_TURNS || String(PASSTHROUGH_COMPACT_KEEP_MIN),
  10,
);
let lastInputTokensRemaining = null;
let lastInputTokensLimit = null;
let consecutive429s = 0;
let lastPayloadBytes = 0;
const BYTES_PER_TOKEN_EST = core._envNumber('HME_PROXY_BYTES_PER_TOKEN_EST', 3.5);
const DYNAMIC_THRESHOLD_FLOOR_BYTES = parseInt(process.env.HME_PROXY_COMPACT_FLOOR_BYTES || '999000', 10);
const MODEL_CONTEXT_FRACTION = core._envNumber('HME_PROXY_CONTEXT_FRACTION', 0.90);
const CONTEXT_PREFLIGHT_FRACTION = core._envNumber('HME_PROXY_CONTEXT_PREFLIGHT_FRACTION', MODEL_CONTEXT_FRACTION);
const CONTEXT_SIGNAL_REMAINING_FRACTION = core._envNumber('HME_PROXY_CONTEXT_SIGNAL_REMAINING_FRACTION', 0.25);
const CONTEXT_BYTES_PER_TOKEN_EST = core._envNumber('HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST', 2.2);

function effectiveCompactThreshold() {
  let ceiling;
  if (COMPACT_BYTES_EXPLICIT) ceiling = PASSTHROUGH_COMPACT_BYTES;
  else if (lastInputTokensLimit != null && lastInputTokensLimit > 0) ceiling = Math.floor(lastInputTokensLimit * MODEL_CONTEXT_FRACTION * BYTES_PER_TOKEN_EST);
  else ceiling = PASSTHROUGH_COMPACT_BYTES;
  let panicCap = ceiling;
  if (consecutive429s > 0) panicCap = Math.max(DYNAMIC_THRESHOLD_FLOOR_BYTES, Math.floor(ceiling / Math.pow(2, consecutive429s)));
  let remainingCap = ceiling;
  if (lastInputTokensRemaining != null && lastInputTokensRemaining > 0) {
    const remainingFraction = Number(process.env.HME_PROXY_REMAINING_FRACTION || '0.80');
    remainingCap = Math.floor(lastInputTokensRemaining * remainingFraction * BYTES_PER_TOKEN_EST);
  }
  return Math.max(DYNAMIC_THRESHOLD_FLOOR_BYTES, Math.min(panicCap, remainingCap));
}

let opusInflight = Promise.resolve();
let lastOpusFinishedAt = 0;
const OPUS_MIN_GAP_MS = parseInt(process.env.HME_PROXY_OPUS_MIN_GAP_MS || '6000', 10);
const OPUS_GATE_OFF = process.env.HME_PROXY_OPUS_GATE_OFF === '1';
async function acquireOpusSlot() {
  if (OPUS_GATE_OFF) return () => {};
  const prev = opusInflight;
  let release;
  opusInflight = new Promise((r) => { release = r; });
  try { await prev; } catch (_) {}
  const sinceLast = Date.now() - lastOpusFinishedAt;
  if (lastOpusFinishedAt > 0 && sinceLast < OPUS_MIN_GAP_MS) {
    const delay = OPUS_MIN_GAP_MS - sinceLast;
    console.error(`Opus-gate: queuing ${delay}ms (rolling-window protection)`);
    await new Promise((r) => setTimeout(r, delay));
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lastOpusFinishedAt = Date.now();
    release();
  };
}

function resolveModelCtx(modelId) {
  const map = {
    'deepseek-v4-pro': 1048576, 'deepseek-v4-flash': 1048576,
    'mimo-v2.5-pro': 1048576, 'mimo-v2-pro': 1048576,
    'glm-5.1': 1048576, 'glm-5': 1048576,
    'kimi-k2.6': 1048576, 'kimi-k2.5': 1048576,
    'minimax-m2.7': 1048576, 'minimax-m2.5': 1048576,
    'qwen3.6-plus': 1048576, 'qwen3.5-plus': 1048576,
    'mistral-large-latest': 131072, 'gemini-2.5-flash': 1048576,
    'llama-4-maverick': 1048576, 'llama-3.3-70b': 131072,
    'gpt-5.5': 1050000, 'gpt-5.4': 400000, 'gpt-5.3': 400000, 'gpt-5.2': 400000,
    'gpt-4o': 200000, 'nemotron-super-49b': 131072, 'nemotron-3-nano': 131072,
  };
  for (const [k, v] of Object.entries(map)) if (String(modelId || '').includes(k)) return v;
  return 1000000;
}
function estimatedContextTokens(bytes) { return Math.ceil(bytes / CONTEXT_BYTES_PER_TOKEN_EST); }
function omniContextThresholdBytes(swapModel) { return Math.floor(resolveModelCtx(String(swapModel || '')) * CONTEXT_PREFLIGHT_FRACTION * CONTEXT_BYTES_PER_TOKEN_EST); }
function injectContextHeader(headers, swapModel) {
  const ctx = resolveModelCtx(swapModel);
  const estUsed = estimatedContextTokens(lastPayloadBytes);
  const remaining = Math.max(0, ctx - estUsed);
  if (remaining < ctx * CONTEXT_SIGNAL_REMAINING_FRACTION) {
    headers['anthropic-ratelimit-input-tokens-remaining'] = String(remaining);
    console.error(`[hme-proxy] context signal: ~${estUsed}/${ctx} tokens (${remaining} remaining) -> triggering /compact`);
  }
}
function shrinkForProxyPassthrough(payload) {
  return shrinkForPassthrough(payload, {
    effectiveThreshold: effectiveCompactThreshold,
    keepMin: PASSTHROUGH_COMPACT_KEEP_MIN,
    maxToolResultAge: STALE_TOOL_KEEP_TURNS,
    projectRoot: require('./shared').PROJECT_ROOT,
  });
}
function shrinkForOmniContext(payload, swapModel) {
  const threshold = omniContextThresholdBytes(swapModel);
  const before = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (before <= threshold) return 0;
  const changed = shrinkForPassthrough(payload, {
    threshold,
    keepMin: PASSTHROUGH_COMPACT_KEEP_MIN,
    maxToolResultAge: STALE_TOOL_KEEP_TURNS,
    env: { ...process.env, HME_PROXY_LOCAL_SUMMARY: process.env.HME_PROXY_OMNI_LOCAL_SUMMARY || process.env.HME_PROXY_LOCAL_SUMMARY || '0' },
    log: (msg) => console.error(`[hme-proxy] omni-context ${msg}`),
    projectRoot: require('./shared').PROJECT_ROOT,
  });
  const after = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  console.error(`[hme-proxy] omni-context preflight: ${before}B -> ${after}B threshold=${threshold}B model=${swapModel} est=${estimatedContextTokens(after)}/${resolveModelCtx(String(swapModel || ''))} tokens changed=${changed}`);
  return changed;
}

const handleRequest = createClaudeHandler({
  PORT, PROXY_VERSION, PROXY_GIT_SHA, PROXY_STARTED_AT,
  routeMetrics: proxyRouteMetrics.metrics,
  recordProxyRoute: proxyRouteMetrics.recordRoute,
  recordProxyError: proxyRouteMetrics.recordError,
  WORKER_PORT, SUPERVISE,
  effectiveCompactThreshold,
  shrinkForPassthrough: shrinkForProxyPassthrough,
  shrinkForContext: shrinkForOmniContext,
  injectContextHeader,
  acquireOpusSlot,
  anthropicTextSseBuffer: core._anthropicTextSseBuffer,
  getConsecutive429s: () => consecutive429s,
  setConsecutive429s: (n) => { consecutive429s = n; },
  incConsecutive429s: () => { consecutive429s = Math.min(consecutive429s + 1, 4); return consecutive429s; },
  getLastInputTokensRemaining: () => lastInputTokensRemaining,
  setLastInputTokensRemaining: (n) => { lastInputTokensRemaining = n; },
  getLastInputTokensLimit: () => lastInputTokensLimit,
  setLastInputTokensLimit: (n) => { lastInputTokensLimit = n; },
  getLastPayloadBytes: () => lastPayloadBytes,
  setLastPayloadBytes: (n) => { lastPayloadBytes = n; },
  loadedMiddleware,
});

function runTestMode() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (raw += chunk));
  process.stdin.on('end', () => {
    let payload = null;
    try { payload = JSON.parse(raw); }
    catch (err) {
      console.error('test mode: invalid JSON on stdin:', err.message);
      process.exit(2);
    }
    const session = sessionKey(payload);
    const scan = scanMessages(payload);
    const jurisdictionBlock = scan.jurisdictionTargets.length ? buildJurisdictionContext(scan.jurisdictionTargets) : null;
    const out = {
      session,
      tool_calls: scan.toolCalls,
      hme_read_prior: scan.hmeReadCalled,
      write_intent: scan.writeIntentCalled,
      violation: scan.writeIntentCalled && !scan.hmeReadCalled,
      first_write_before_read: scan.firstWriteBeforeRead,
      write_targets: scan.writeTargets,
      jurisdiction_targets: scan.jurisdictionTargets,
      jurisdiction_block_preview: jurisdictionBlock ? jurisdictionBlock.slice(0, 500) : null,
    };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    process.exit(out.violation ? 1 : 0);
  });
}

if (process.env.HME_PROXY_EXPORT_INTERNALS === '1') {
  module.exports = { __hmeProxyInternals: core.__hmeProxyInternals, handleRequest };
} else if (process.argv.includes('--test')) {
  runTestMode();
} else {
  const supervisor = require('./supervisor/index');
  if (SUPERVISE) supervisor.start();
  else supervisor.installShutdownHandlers();
  const server = http.createServer(handleRequest);
  supervisor.registerServer(server);
  server.listen(PORT, '127.0.0.1', () => {
    const scheme = DEFAULT_UPSTREAM_TLS ? 'https' : 'http';
    emitStartMarker('hme_proxy', { port: PORT, git: PROXY_GIT_SHA });
    console.log(`hme-proxy listening on http://127.0.0.1:${PORT}`);
    console.log(`  Anthropic upstream: ${scheme}://${DEFAULT_UPSTREAM_HOST}:${DEFAULT_UPSTREAM_PORT}`);
    console.log(`  worker upstream: http://127.0.0.1:${WORKER_PORT} (supervised, /mcp/* routed here)`);
    if (!SUPERVISE) console.log('  supervision: disabled (HME_PROXY_SUPERVISE=0)');
  });
  server.on('error', (err) => {
    proxyRouteMetrics.recordError(err);
    console.error('listen error:', err.message);
    process.exit(1);
  });
}
