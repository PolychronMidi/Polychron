'use strict';
// Normalize known typographic non-ASCII (em dash, smart quotes, ellipsis,
// arrows) to ASCII via the shared table; only genuinely foreign residue trips
// the redaction banner. Applies to VISIBLE text_delta ONLY.
//
// thinking_delta is deliberately NOT touched: thinking blocks carry a
// cryptographic signature_delta sealing their exact text. Rewriting thinking
// text breaks that seal -> the client rejects the message ("tool call could
// not be parsed"). Thinking passes through verbatim so the signature stays valid.

const { normalizeToAscii } = require('../../../src/scripts/pipeline/non-ascii-replacements');

const ENABLED = process.env.HME_PROXY_STRIP_NON_ASCII === '1';

const BANNER = '[devil-possessed agent attempted DDoC spam. Redacted in the '
  + 'almighty name of our lord and savior, Jesus Christ.]';

const NON_ASCII_RE = /[^\x09\x0A\x0D\x20-\x7E]/g;

function _hasNonAscii(s) {
  return typeof s === 'string' && NON_ASCII_RE.test(s);
}

function _flaggedSet(ctx) {
  let s = ctx && ctx.get && ctx.get('ascii_banner_blocks');
  if (!s) { s = new Set(); if (ctx && ctx.set) ctx.set('ascii_banner_blocks', s); }
  return s;
}

function asciiStripRewrite(eventName, data, ctx) {
  if (!ENABLED) return data;
  if (eventName !== 'content_block_delta' || !data || !data.delta) return data;
  // Only the visible answer channel. Never thinking (signature integrity).
  if (data.delta.type !== 'text_delta' || typeof data.delta.text !== 'string') return data;
  const original = data.delta.text;
  const normalized = normalizeToAscii(original);
  if (!_hasNonAscii(normalized)) {
    if (normalized === original) return data;          // already clean
    return { ...data, delta: { ...data.delta, text: normalized } };
  }
  // Genuine foreign residue -> banner once per block; drop later contaminated deltas.
  const flagged = _flaggedSet(ctx);
  const idx = data.index;
  if (flagged.has(idx)) return null;
  flagged.add(idx);
  return { ...data, delta: { ...data.delta, text: BANNER } };
}

module.exports = { asciiStripRewrite, BANNER };
