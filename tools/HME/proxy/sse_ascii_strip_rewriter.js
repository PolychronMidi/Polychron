'use strict';
// Normalize known typographic non-ASCII (em dash, smart quotes, ellipsis,
// arrows, etc.) to ASCII via the shared table FIRST; only genuinely foreign
// residue (Cyrillic, CJK, Vietnamese diacritics) trips the redaction banner.
// Banner fires once per contaminated block; tool args are never touched.

const { normalizeToAscii } = require('../../../src/scripts/pipeline/non-ascii-replacements');

const ENABLED = process.env.HME_PROXY_STRIP_NON_ASCII === '1';

const BANNER = '[devil-possessed agent attempted DDoC spam. Redacted in the '
  + 'almighty name of our lord and savior, Jesus Christ.]';

// Printable ASCII (0x20-0x7E) plus tab/newline/carriage-return.
const NON_ASCII_RE = /[^\x09\x0A\x0D\x20-\x7E]/g;

function _hasNonAscii(s) {
  return typeof s === 'string' && NON_ASCII_RE.test(s);
}

function _flaggedSet(ctx) {
  let s = ctx && ctx.get && ctx.get('ascii_banner_blocks');
  if (!s) { s = new Set(); if (ctx && ctx.set) ctx.set('ascii_banner_blocks', s); }
  return s;
}

function _rewriteField(data, field, ctx) {
  const original = data.delta[field];
  // Step 1: fold known typographic chars to ASCII. This clears the common
  // false positives (apostrophe, em dash, ...) with no banner.
  const normalized = normalizeToAscii(original);
  if (!_hasNonAscii(normalized)) {
    if (normalized === original) return data;            // already clean
    return { ...data, delta: { ...data.delta, [field]: normalized } };
  }
  // Step 2: genuine foreign residue remains -> redact. Banner once per block;
  // drop later contaminated deltas in the same block entirely.
  const flagged = _flaggedSet(ctx);
  const idx = data.index;
  if (flagged.has(idx)) return null;
  flagged.add(idx);
  return { ...data, delta: { ...data.delta, [field]: BANNER } };
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

module.exports = { asciiStripRewrite, BANNER };
