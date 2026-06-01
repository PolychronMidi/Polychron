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

function semanticTokenEstimate(payload, env = process.env) {
  if (!payload || typeof payload !== 'object') return 0;
  const perTok = positiveNumber(env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST) || 4;
  let chars = 0;
  chars += _contentTokenChars(payload.system);
  chars += _contentTokenChars(payload.messages);
  chars += _contentTokenChars(payload.tools);
  // Small framing allowance for roles/types/tool names without letting JSON
  // escapes, cache metadata, or encrypted signatures dominate the estimate.
  const msgCount = Array.isArray(payload.messages) ? payload.messages.length : 0;
  const toolCount = Array.isArray(payload.tools) ? payload.tools.length : 0;
  chars += 32 * msgCount + 96 * toolCount;
  const contentEstimate = Math.ceil(chars / perTok);
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
