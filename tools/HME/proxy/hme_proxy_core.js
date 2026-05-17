'use strict';

const { stripStaleToolResults, sanitizeMessages } = require('./conversation_graph');
const hmeDispatcher = require('./hme_dispatcher');

const HME_PREFIX = /^mcp__HME__/;
const PROXY_STARTED_AT = new Date().toISOString();
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
function _loadedMiddleware() {
  try { return require('./middleware/index').loadedNames(); }
  catch (_) { return []; }
}
function _stripHmePrefixOutgoing(payload) {
  // Backward-compat: message histories may still contain mcp__HME__ tool_uses
  // from prior sessions. Rename to HME_ so the model sees a consistent name.
  let changed = false;
  const rename = (name) => {
    if (typeof name !== 'string') return name;
    if (!HME_PREFIX.test(name)) return name;
    changed = true;
    return name.replace(HME_PREFIX, 'HME_');
  };
  if (Array.isArray(payload.messages)) {
    for (const msg of payload.messages) {
      if (!msg || !Array.isArray(msg.content)) continue;
      for (const block of msg.content) {
        if (block && block.type === 'tool_use') block.name = rename(block.name);
      }
    }
  }
  // Remove any deprecated mcp__HME__* tools from payload.tools -- they would
  // collide with our proxy-injected HME_ versions on the next step.
  if (Array.isArray(payload.tools)) {
    const before = payload.tools.length;
    payload.tools = payload.tools.filter((t) => !(t && HME_PREFIX.test(t.name || '')));
    if (payload.tools.length !== before) changed = true;
  }
  return changed;
}

// Upstream failure detection across both Anthropic error shapes (HTTP 4xx/5xx
// with JSON error, OR HTTP 200 + SSE `event: error`). Implementation in
// failure_classification.js; binding into local names preserves call sites.
const {
  _tryParseJson,
  detectUpstreamFailure: _detectUpstreamFailure,
  alertCooldownActive: _alertCooldownActive,
} = require('./failure_classification');

// Passthrough emergency compaction: drop oldest message PAIRS until payload
// is under the byte cap. Default 250KB (~71K tokens at 3.5 bytes/token);
// derived from ITPM cap once a response header reveals it (50% rule).
// HME_NO_PASSTHROUGH_COMPACT=1 to skip; HME_PROXY_COMPACT_BYTES to override.
const _PASSTHROUGH_COMPACT_BYTES = parseInt(process.env.HME_PROXY_COMPACT_BYTES || '250000', 10);
const _COMPACT_BYTES_EXPLICIT = process.env.HME_PROXY_COMPACT_BYTES != null
  && process.env.HME_PROXY_COMPACT_BYTES !== '';
const _PASSTHROUGH_COMPACT_KEEP_MIN = parseInt(process.env.HME_PROXY_COMPACT_KEEP_MIN || '100', 10);
const _STALE_TOOL_KEEP_TURNS = parseInt(
  process.env.HME_PROXY_STALE_TOOL_KEEP_TURNS || String(_PASSTHROUGH_COMPACT_KEEP_MIN),
  10,
);

// Dynamic threshold: track the most recent ITPM-remaining from Anthropic
// response headers and shrink the byte budget when we're close to the
// rate-limit ceiling. ~3.5 bytes/token is the rough conversion for
// Claude-Code-shape JSON payloads. Floor so we never over-shrink.
let _lastInputTokensRemaining = null; // updated by response handler
let _lastInputTokensLimit = null;     // user's actual ITPM cap, learned from headers
let _consecutive429s = 0;             // panic-shrink trigger: each 429 halves threshold
let _lastPayloadBytes = 0;            // last OmniRoute payload size for context monitoring
function _envNumber(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
const _BYTES_PER_TOKEN_EST = _envNumber('HME_PROXY_BYTES_PER_TOKEN_EST', 3.5);
// Conservative OmniRoute preflight: dumps near 2.75MB were already rejected
// as >1M context after provider translation.
const _CONTEXT_BYTES_PER_TOKEN_EST = _envNumber('HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST', 2.2);
const _DYNAMIC_THRESHOLD_FLOOR_BYTES = parseInt(process.env.HME_PROXY_COMPACT_FLOOR_BYTES || '999000', 10);
const _MODEL_CONTEXT_FRACTION = _envNumber('HME_PROXY_CONTEXT_FRACTION', 0.90);
const _CONTEXT_PREFLIGHT_FRACTION = _envNumber('HME_PROXY_CONTEXT_PREFLIGHT_FRACTION', _MODEL_CONTEXT_FRACTION);
const _CONTEXT_SIGNAL_REMAINING_FRACTION = _envNumber('HME_PROXY_CONTEXT_SIGNAL_REMAINING_FRACTION', 0.25);
function _effectiveCompactThreshold() {
  // CEILING: HME_PROXY_COMPACT_BYTES (explicit) honored as hard cap.
  // Otherwise: % of learned ITPM cap (leaves room for response +
  // parallel sub-calls). Falls back to 250 KB pre-first-response.
  let ceiling;
  if (_COMPACT_BYTES_EXPLICIT) {
    ceiling = _PASSTHROUGH_COMPACT_BYTES;
  } else if (_lastInputTokensLimit != null && _lastInputTokensLimit > 0) {
    ceiling = Math.floor(_lastInputTokensLimit * _MODEL_CONTEXT_FRACTION * _BYTES_PER_TOKEN_EST);
  } else {
    ceiling = _PASSTHROUGH_COMPACT_BYTES;
  }

  // PANIC SHRINK: each consecutive 429 halves the ceiling. Resets to 0
  // on a successful response. Without this we'd loop 429ing at the
  // same size forever -- the dynamic-from-remaining path only activates
  // on a 200 response that gives us the remaining-tokens header.
  let panicCap = ceiling;
  if (_consecutive429s > 0) {
    panicCap = Math.max(_DYNAMIC_THRESHOLD_FLOOR_BYTES, Math.floor(ceiling / Math.pow(2, _consecutive429s)));
  }

  // From CURRENT remaining (what's left in this rolling minute): 70%
  // of remaining lets us fit the request and leave headroom.
  let remainingCap = ceiling;
  if (_lastInputTokensRemaining != null && _lastInputTokensRemaining > 0) {
    const remainingFraction = Number(process.env.HME_PROXY_REMAINING_FRACTION || '0.80');
    remainingCap = Math.floor(_lastInputTokensRemaining * remainingFraction * _BYTES_PER_TOKEN_EST);
  }

  const eff = Math.min(panicCap, remainingCap);
  return Math.max(_DYNAMIC_THRESHOLD_FLOOR_BYTES, eff);
}
// Context monitoring: injects anthropic-ratelimit-input-tokens-remaining header
// to trigger Claude Code's native /compact when context approaches model limits.
const _MODEL_CTX = {
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
const _DEFAULT_CTX = 1000000;

function _resolveModelCtx(modelId) {
  for (const [k, v] of Object.entries(_MODEL_CTX)) {
    if (modelId.includes(k)) return v;
  }
  return _DEFAULT_CTX;
}

function _estimatedContextTokens(bytes) {
  return Math.ceil(bytes / _CONTEXT_BYTES_PER_TOKEN_EST);
}

function _omniContextThresholdBytes(swapModel) {
  const ctx = _resolveModelCtx(String(swapModel || ''));
  return Math.floor(ctx * _CONTEXT_PREFLIGHT_FRACTION * _CONTEXT_BYTES_PER_TOKEN_EST);
}

function _injectContextHeader(headers, swapModel) {
  const ctx = _resolveModelCtx(swapModel);
  const estUsed = _estimatedContextTokens(_lastPayloadBytes);
  const remaining = Math.max(0, ctx - estUsed);
  if (remaining < ctx * _CONTEXT_SIGNAL_REMAINING_FRACTION) {
    headers['anthropic-ratelimit-input-tokens-remaining'] = String(remaining);
    console.error(`[hme-proxy] context signal: ~${estUsed}/${ctx} tokens (${remaining} remaining) -> triggering /compact`);
  }
}

function _anthropicTextSseBuffer(model, text) {
  const id = `proxy_${Date.now()}`;
  const m = String(model || 'hme-proxy');
  const t = String(text || '');
  const chunks = [
    ['message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model: m, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 0 } }],
    ['message_stop', { type: 'message_stop' }],
  ];
  return Buffer.from(chunks.map(([ev, data]) => `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`).join(''), 'utf8');
}

// Strip tool_result blocks older than the configured retention horizon.
function _stripStaleToolResults(payload) {
  if (_STALE_TOOL_KEEP_TURNS <= 0) return 0;
  return stripStaleToolResults(payload, _STALE_TOOL_KEEP_TURNS);
}

// Strip the Claude Code identity sentence from the system prompt array
// when routing to non-Anthropic models.
function _stripClaudeIdentity(payload) {
  if (!payload || !Array.isArray(payload.system)) return;
  payload.system = payload.system.filter(block => {
    if (!block || block.type !== 'text') return true;
    const t = block.text || '';
    return !t.startsWith('You are Claude Code');
  });
}

function _shrinkForPassthrough(payload) {
  return shrinkForPassthrough(payload, {
    effectiveThreshold: _effectiveCompactThreshold,
    keepMin: _PASSTHROUGH_COMPACT_KEEP_MIN,
    maxToolResultAge: _STALE_TOOL_KEEP_TURNS,
    projectRoot: require('./shared').PROJECT_ROOT,
  });
}

function _shrinkForOmniContext(payload, swapModel) {
  const threshold = _omniContextThresholdBytes(swapModel);
  const before = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (before <= threshold) return 0;
  const changed = shrinkForPassthrough(payload, {
    threshold,
    keepMin: _PASSTHROUGH_COMPACT_KEEP_MIN,
    maxToolResultAge: _STALE_TOOL_KEEP_TURNS,
    env: { ...process.env, HME_PROXY_LOCAL_SUMMARY: process.env.HME_PROXY_OMNI_LOCAL_SUMMARY || process.env.HME_PROXY_LOCAL_SUMMARY || '0' },
    log: (msg) => console.error(`[hme-proxy] omni-context ${msg}`),
    projectRoot: require('./shared').PROJECT_ROOT,
  });
  const after = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  console.error(`[hme-proxy] omni-context preflight: ${before}B -> ${after}B threshold=${threshold}B model=${swapModel} est=${_estimatedContextTokens(after)}/${_resolveModelCtx(String(swapModel || ''))} tokens changed=${changed}`);
  return changed;
}


function _sanitizePayload(payload) {
  return sanitizeMessages(payload);
}


async function _injectHmeTools(payload) {
  // HME tools are invoked as Bash(`npm run <tool>`) calls; inline API-tool
  // injection is disabled by default. Set HME_INJECT_TOOLS=1 in .env to
  // restore the old path (Claude sees HME_* as inline tools directly).
  if (process.env.HME_INJECT_TOOLS !== '1') return 0;
  if (!Array.isArray(payload.tools)) payload.tools = [];
  try {
    const schemas = await hmeDispatcher.getSchemasCached();
    // Do NOT strip Claude Code's cache_control markers -- they're part of
    // the cache key. Don't add our own either (our ttl=5m after CC's ttl=1h
    // produces a 400). Skip already-present HME_ tools (retry-idempotent).
    const existing = new Set(payload.tools.map((t) => t && t.name).filter(Boolean));
    let injected = 0;
    for (const s of schemas) {
      if (!existing.has(s.name)) { payload.tools.push({ ...s }); injected++; }
    }
    return injected;
  } catch (err) {
    console.error(`[FAIL]: ${err.message}`);
    return 0;
  }
}

const STOP_REMINDER_FILE = require('path').join(require('./shared').PROJECT_ROOT, 'tmp', 'hme-stop-reminder.json');

function _consumeStopReminderSystemText(file = STOP_REMINDER_FILE) {
  const fs = require('fs');
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch (_err) { return ''; }
  try { fs.unlinkSync(file); } catch (_err) { /* silent-ok: best-effort consume once */ }
  let data = {};
  try { data = JSON.parse(raw); } catch (_err) { return ''; }
  return String((data && data.text) || '').trim();
}

function _stopReminderPending(file = STOP_REMINDER_FILE) {
  try { return require('fs').existsSync(file); }
  catch (_err) { return false; }
}

function _extractTextContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b) => {
    if (!b) return '';
    if (typeof b === 'string') return b;
    if (typeof b.text === 'string') return b.text;
    return '';
  }).filter(Boolean).join('\n');
}

function _appendTextContent(content, text) {
  const block = { type: 'text', text };
  if (typeof content === 'string') return `${content}\n\n${text}`;
  if (Array.isArray(content)) return [...content, block];
  return [block];
}

function _normalizeSystemArray(payload) {
  if (!payload || payload.system == null) {
    payload.system = [];
    return true;
  }
  if (typeof payload.system === 'string') {
    payload.system = [{ type: 'text', text: payload.system }];
    return true;
  }
  if (Array.isArray(payload.system)) return true;
  return false;
}

function _injectStopReminderSystem(payload, file = STOP_REMINDER_FILE) {
  const text = _consumeStopReminderSystemText(file);
  if (!text || !payload || !_normalizeSystemArray(payload)) return false;
  const marker = 'HME Stop Hook Feedback (proxy-injected)';
  if (payload.system.some((b) => String((b && b.text) || b || '').includes(marker))) return false;
  const cleanText = text.replace(/^<system-reminder>\s*/i, '').replace(/\s*<\/system-reminder>$/i, '').trim();
  payload.system.push({ type: 'text', text: `<system-reminder>\n${marker}\n${cleanText}\n</system-reminder>` });
  return true;
}

function _stopGateHealth() {
  const registry = require('fs').readFileSync(
    require('path').join(require('./shared').PROJECT_ROOT, 'tools', 'HME', 'scripts', 'detectors', 'registry.json'),
    'utf8',
  );
  return {
    transport_mode: 'structured-stop-decision-with-proxy-system-injection',
    reminder_file: STOP_REMINDER_FILE,
    reminder_pending: _stopReminderPending(),
    registry_hash: require('crypto').createHash('sha256').update(registry).digest('hex').slice(0, 16),
    middleware: _loadedMiddleware(),
    started_at: PROXY_STARTED_AT,
    git_sha: PROXY_GIT_SHA,
  };
}

const __hmeProxyInternals = {
  STOP_REMINDER_FILE,
  _consumeStopReminderSystemText,
  _stopReminderPending,
  _normalizeSystemArray,
  _extractTextContent,
  _appendTextContent,
  _injectStopReminderSystem,
  _stopGateHealth,
};
module.exports = {
  _stripHmePrefixOutgoing,
  _envNumber,
  _resolveModelCtx,
  _estimatedContextTokens,
  _anthropicTextSseBuffer,
  _stripStaleToolResults,
  _stripClaudeIdentity,
  _sanitizePayload,
  _injectHmeTools,
  STOP_REMINDER_FILE,
  _consumeStopReminderSystemText,
  _stopReminderPending,
  _extractTextContent,
  _appendTextContent,
  _normalizeSystemArray,
  _injectStopReminderSystem,
  _stopGateHealth,
  __hmeProxyInternals,
};
