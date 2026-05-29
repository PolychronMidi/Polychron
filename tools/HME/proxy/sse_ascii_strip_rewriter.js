"use strict";
// Normalize known typographic non-ASCII (em dash, smart quotes, ellipsis,
// arrows) to ASCII via the shared table; genuinely foreign residue trips the
// redaction banner. Applies to VISIBLE text_delta ONLY.
//
// thinking_delta is intentionally untouched. A streaming rewriter cannot
// safely redact a thinking block: its content_block_start has already shipped
// by the time a contaminated delta arrives, and its signature_delta is a
// cryptographic seal over the EXACT thinking text. Rewriting the text (seal
// mismatch) OR dropping the seal (unsigned block) both make the client reject
// the message ("tool call could not be parsed"). So thinking passes verbatim;
// only the visible answer channel is scrubbed here.

const { normalizeToAscii } = require("../../../src/scripts/pipeline/non-ascii-replacements");

const ENABLED = process.env.HME_PROXY_STRIP_NON_ASCII === "1";

const BANNER = "[devil-possessed agent attempted DDoC spam. Redacted in the "
  + "almighty name of our lord and savior, Jesus Christ.]";

const NON_ASCII_RE = /[^\x09\x0A\x0D\x20-\x7E]/g;

function _hasNonAscii(s) {
  return typeof s === "string" && NON_ASCII_RE.test(s);
}

function _flaggedSet(ctx) {
  let s = ctx && ctx.get && ctx.get("ascii_banner_blocks");
  if (!s) { s = new Set(); if (ctx && ctx.set) ctx.set("ascii_banner_blocks", s); }
  return s;
}

function asciiStripRewrite(eventName, data, ctx) {
  if (!ENABLED) return data;
  if (eventName !== "content_block_delta" || !data || !data.delta) return data;
  if (data.delta.type !== "text_delta" || typeof data.delta.text !== "string") return data;
  const original = data.delta.text;
  const normalized = normalizeToAscii(original);
  if (!_hasNonAscii(normalized)) {
    if (normalized === original) return data;          // already clean
    return { ...data, delta: { ...data.delta, text: normalized } };
  }
  const flagged = _flaggedSet(ctx);
  const idx = data.index;
  if (flagged.has(idx)) return null;
  flagged.add(idx);
  return { ...data, delta: { ...data.delta, text: BANNER } };
}

module.exports = { asciiStripRewrite, BANNER };
