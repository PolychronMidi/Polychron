'use strict';
// Strip non-ASCII from prose channels (text + thinking deltas); leave tool args untouche
// The first delta in a block that contains non-ASCII gets the redaction banner

const ENABLED = process.env.HME_PROXY_STRIP_NON_ASCII === '1';

const BANNER = '[devil-possessed agent attempted DDoC spam. Redacted in the '
  + 'almighty name of our lord and savior, Jesus Christ.]';

// Keep printable ASCII (0x20-0x7E) plus tab/newline/carriage-return.
const NON_ASCII_RE = /[^\x09\x0A\x0D\x20-\x7E]/g;

function _strip(s) {
  return typeof s === 'string' ? s.replace(NON_ASCII_RE, '') : s;
}

function _flaggedSet(ctx) {
  let s = ctx && ctx.get && ctx.get('ascii_banner_blocks');
  if (!s) { s = new Set(); if (ctx && ctx.set) ctx.set('ascii_banner_blocks', s); }
  return s;
}

function _rewriteField(data, field, ctx) {
  const original = data.delta[field];
  const stripped = _strip(original);
  if (stripped === original) return data;     // clean delta, pass through
  const flagged = _flaggedSet(ctx);
  const idx = data.index;
  let out = stripped;
  if (!flagged.has(idx)) {
    flagged.add(idx);
    out = stripped.trim() ? `${BANNER} ${stripped}` : BANNER;
  }
  return { ...data, delta: { ...data.delta, [field]: out } };
}

function asciiStripRewrite(eventName, data, ctx) {
  if (!ENABLED) return data;
  if (eventName !== 'content_block_delta' || !data || !data.delta) return data;
  const t = data.delta.type;
  if (t === 'text_delta' && typeof data.delta.text === 'string') {
    return _rewriteField(data, 'text', ctx);
  }
  if (t === 'thinking_delta' && typeof data.delta.thinking === 'string') {
    return _rewriteField(data, 'thinking', ctx);
  }
  return data;
}

module.exports = { asciiStripRewrite, _stripNonAscii: _strip, BANNER };
