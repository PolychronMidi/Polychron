'use strict';

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function _contentTokenChars(value) {
  if (value == null) return 0;
  if (typeof value === 'string') return value.length;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).length;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + _contentTokenChars(item), 0);
  if (typeof value !== 'object') return 0;

  const type = String(value.type || '');
  if (type === 'thinking' || type === 'redacted_thinking') {
    return _contentTokenChars(value.thinking) + _contentTokenChars(value.text) + _contentTokenChars(value.summary);
  }

  let total = 0;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'signature' || key === 'cache_control') continue;
    total += _contentTokenChars(child);
  }
  return total;
}

function _tokenCharBuckets(value, inToolResult = false) {
  const out = { regular: 0, toolResult: 0 };
  function add(bucket) {
    out.regular += bucket.regular || 0;
    out.toolResult += bucket.toolResult || 0;
  }
  if (value == null) return out;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const n = String(value).length;
    if (inToolResult) out.toolResult += n;
    else out.regular += n;
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) add(_tokenCharBuckets(item, inToolResult));
    return out;
  }
  if (typeof value !== 'object') return out;

  const type = String(value.type || '');
  const nextInToolResult = inToolResult || type === 'tool_result';
  if (type === 'thinking' || type === 'redacted_thinking') {
    add(_tokenCharBuckets(value.thinking, nextInToolResult));
    add(_tokenCharBuckets(value.text, nextInToolResult));
    add(_tokenCharBuckets(value.summary, nextInToolResult));
    return out;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === 'signature' || key === 'cache_control') continue;
    add(_tokenCharBuckets(child, nextInToolResult));
  }
  return out;
}

function semanticTokenEstimate(payload, env = process.env) {
  if (!payload || typeof payload !== 'object') return 0;
  const perTok = positiveNumber(env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST) || 4;
  // Tool results are the dominant failure mode for OmniRoute over-window misses:
  // large command/read outputs tokenize closer to ~1.8 bytes/token in the Codex
  const toolResultPerTok = positiveNumber(env.HME_PROXY_TOOL_RESULT_BYTES_PER_TOKEN_EST)
    || positiveNumber(env.HME_PROXY_CONTEXT_TOOL_RESULT_BYTES_PER_TOKEN_EST)
    || 1.8;
  const buckets = { regular: 0, toolResult: 0 };
  for (const part of [payload.system, payload.messages, payload.tools]) {
    const b = _tokenCharBuckets(part);
    buckets.regular += b.regular;
    buckets.toolResult += b.toolResult;
  }
  // Small framing allowance for roles/types/tool names without letting JSON
  // escapes, cache metadata, or encrypted signatures dominate the estimate.
  const msgCount = Array.isArray(payload.messages) ? payload.messages.length : 0;
  const toolCount = Array.isArray(payload.tools) ? payload.tools.length : 0;
  buckets.regular += 32 * msgCount + 96 * toolCount;
  const contentEstimate = Math.ceil((buckets.regular / perTok) + (buckets.toolResult / toolResultPerTok));
  // Conservative floor: the content-only walk skips JSON structural framing
  // (keys, braces, tool_use ids, type tags) that real tokenizers DO count.
  const structuralFloor = Math.ceil(_serializedBytesNoSignatures(payload) / perTok);
  return Math.max(contentEstimate, structuralFloor);
}

function _serializedBytesNoSignatures(payload) {
  return Buffer.byteLength(
    JSON.stringify(payload || {}, (k, v) => (k === 'signature' || k === 'cache_control' ? undefined : v)),
    'utf8',
  );
}

function serializedBytes(payload) {
  return Buffer.byteLength(JSON.stringify(payload || {}), 'utf8');
}

module.exports = { semanticTokenEstimate, serializedBytes };
