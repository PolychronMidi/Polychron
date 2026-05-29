"use strict";
// DDoC non-ASCII scrubber for ALL response channels. Block structure and
// indices are preserved (no shifting) so the client's block table stays in
// sync; only delta CONTENT is scrubbed.
//
// text_delta: typography folded to ASCII via shared table; genuinely foreign
//   residue replaced inline with the redaction banner (once per block, later
//   contaminated deltas dropped).
// thinking_delta: folded to ASCII; if foreign residue remains, the delta text
//   is replaced with a minimal "." placeholder (once per block, later
//   contaminated deltas dropped). The block's signature_delta is then dropped
//   too -- the signature sealed the ORIGINAL text, so keeping it after we
//   changed the text would be a mismatch. Block start/stop stay intact.

const { normalizeToAscii } = require("../../../src/scripts/pipeline/non-ascii-replacements");

const ENABLED = process.env.HME_PROXY_STRIP_NON_ASCII === "1";

const BANNER = "[devil-possessed agent attempted DDoC spam. Redacted in the "
  + "almighty name of our lord and savior, Jesus Christ.]";

const NON_ASCII_RE = /[^\x09\x0A\x0D\x20-\x7E]/g;

function _hasNonAscii(s) {
  // Reset lastIndex -- /g regex .test() is stateful across calls.
  if (typeof s !== "string") return false;
  NON_ASCII_RE.lastIndex = 0;
  return NON_ASCII_RE.test(s);
}

function _ctxSet(ctx, key) {
  let s = ctx && ctx.get && ctx.get(key);
  if (!s) { s = new Set(); if (ctx && ctx.set) ctx.set(key, s); }
  return s;
}

function asciiStripRewrite(eventName, data, ctx) {
  if (!ENABLED) return data;
  if (eventName !== "content_block_delta" || !data || !data.delta) {
    // Drop the seal on any block whose text we redacted.
    if (eventName === "content_block_delta" && data && data.delta
        && data.delta.type === "signature_delta") {
      const redacted = _ctxSet(ctx, "ascii_redacted_blocks");
      if (redacted.has(data.index)) return null;
    }
    return data;
  }
  const t = data.delta.type;

  if (t === "text_delta" && typeof data.delta.text === "string") {
    const original = data.delta.text;
    const normalized = normalizeToAscii(original);
    if (!_hasNonAscii(normalized)) {
      if (normalized === original) return data;
      return { ...data, delta: { ...data.delta, text: normalized } };
    }
    const banner = _ctxSet(ctx, "ascii_banner_blocks");
    if (banner.has(data.index)) return null;
    banner.add(data.index);
    return { ...data, delta: { ...data.delta, text: BANNER } };
  }

  if (t === "thinking_delta" && typeof data.delta.thinking === "string") {
    const original = data.delta.thinking;
    const normalized = normalizeToAscii(original);
    if (!_hasNonAscii(normalized)) {
      if (normalized === original) return data;
      return { ...data, delta: { ...data.delta, thinking: normalized } };
    }
    // Foreign residue: redact to a placeholder, drop this block's signature.
    const redacted = _ctxSet(ctx, "ascii_redacted_blocks");
    redacted.add(data.index);
    const placeheld = _ctxSet(ctx, "ascii_think_placeheld");
    if (placeheld.has(data.index)) return null;     // one placeholder per block
    placeheld.add(data.index);
    return { ...data, delta: { ...data.delta, thinking: "." } };
  }

  if (t === "signature_delta") {
    const redacted = _ctxSet(ctx, "ascii_redacted_blocks");
    if (redacted.has(data.index)) return null;
  }
  return data;
}

module.exports = { asciiStripRewrite, BANNER };
