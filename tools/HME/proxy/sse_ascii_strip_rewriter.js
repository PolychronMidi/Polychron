"use strict";
// Normalize known typographic non-ASCII (em dash, smart quotes, ellipsis,
// arrows) to ASCII via the shared table; only genuinely foreign residue trips
// the redaction banner. Covers BOTH visible text_delta and thinking_delta.
//
// Thinking blocks carry a cryptographic signature_delta sealing their exact
// text. When we redact a thinking block we MUST also drop its signature_delta:
// shipping the banner text with the original seal is a mismatch the client
// rejects ("tool call could not be parsed"). Dropping the seal on a redacted
// block avoids the mismatch while still scrubbing the foreign spam.

const { normalizeToAscii } = require("../../../src/scripts/pipeline/non-ascii-replacements");

const ENABLED = process.env.HME_PROXY_STRIP_NON_ASCII === "1";

const BANNER = "[devil-possessed agent attempted DDoC spam. Redacted in the "
  + "almighty name of our lord and savior, Jesus Christ.]";

const NON_ASCII_RE = /[^\x09\x0A\x0D\x20-\x7E]/g;

function _hasNonAscii(s) {
  return typeof s === "string" && NON_ASCII_RE.test(s);
}

function _ctxSet(ctx, key) {
  let s = ctx && ctx.get && ctx.get(key);
  if (!s) { s = new Set(); if (ctx && ctx.set) ctx.set(key, s); }
  return s;
}

function _rewriteField(data, field, ctx) {
  const original = data.delta[field];
  const normalized = normalizeToAscii(original);
  if (!_hasNonAscii(normalized)) {
    if (normalized === original) return data;          // already clean
    return { ...data, delta: { ...data.delta, [field]: normalized } };
  }
  // Genuine foreign residue -> banner once per block; drop later contaminated
  // deltas in the same block. Record the block as redacted so its signature
  // (if a thinking block) gets dropped too.
  const banner = _ctxSet(ctx, "ascii_banner_blocks");
  const redacted = _ctxSet(ctx, "ascii_redacted_blocks");
  const idx = data.index;
  redacted.add(idx);
  if (banner.has(idx)) return null;
  banner.add(idx);
  return { ...data, delta: { ...data.delta, [field]: BANNER } };
}

function asciiStripRewrite(eventName, data, ctx) {
  if (!ENABLED) return data;
  if (eventName !== "content_block_delta" || !data || !data.delta) return data;
  const t = data.delta.type;
  if (t === "text_delta" && typeof data.delta.text === "string") {
    return _rewriteField(data, "text", ctx);
  }
  if (t === "thinking_delta" && typeof data.delta.thinking === "string") {
    return _rewriteField(data, "thinking", ctx);
  }
  // Drop the seal on any block we redacted -- a banner with the original
  // signature is a mismatch the client rejects.
  if (t === "signature_delta") {
    const redacted = _ctxSet(ctx, "ascii_redacted_blocks");
    if (redacted.has(data.index)) return null;
  }
  return data;
}

module.exports = { asciiStripRewrite, BANNER };
