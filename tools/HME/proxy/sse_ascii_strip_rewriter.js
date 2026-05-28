'use strict';
// Strip non-ASCII from prose channels (text + thinking deltas); leave tool args untouche

const ENABLED = process.env.HME_PROXY_STRIP_NON_ASCII === '1';

// Keep printable ASCII (0x20-0x7E) plus tab/newline/carriage-return.
const NON_ASCII_RE = /[^\x09\x0A\x0D\x20-\x7E]/g;

function _strip(s) {
  return typeof s === 'string' ? s.replace(NON_ASCII_RE, '') : s;
}

function asciiStripRewrite(eventName, data, _ctx) {
  if (!ENABLED) return data;
  if (eventName !== 'content_block_delta' || !data || !data.delta) return data;
  const t = data.delta.type;
  if (t === 'text_delta' && typeof data.delta.text === 'string') {
    const next = _strip(data.delta.text);
    if (next === data.delta.text) return data;
    return { ...data, delta: { ...data.delta, text: next } };
  }
  if (t === 'thinking_delta' && typeof data.delta.thinking === 'string') {
    const next = _strip(data.delta.thinking);
    if (next === data.delta.thinking) return data;
    return { ...data, delta: { ...data.delta, thinking: next } };
  }
  return data;
}

module.exports = { asciiStripRewrite, _stripNonAscii: _strip };
