"use strict";
// DDoC non-ASCII scrubber for BOTH visible text and thinking channels.
//
// Evidence (request history): thinking blocks whose text was replaced with the
// banner but whose original signature_delta was KEPT round-trip at 200 OK --
// Anthropic does not re-validate the signature against the thinking text on
// these requests. What DID cause "tool call could not be parsed" was DROPPING
// the signature (an unsigned thinking block). So: redact the text, KEEP the
// signature.
//
// text_delta: typography folded to ASCII; sparse stray non-ASCII stripped
//   inline; dense foreign script -> banner (once per block).
// thinking_delta: same policy. Once a block is bannered, later contaminated
//   thinking deltas in that block are dropped; the signature_delta passes
//   through untouched so the block stays signed.

const { normalizeToAscii } = require("../../../src/scripts/pipeline/non-ascii-replacements");

const ENABLED = process.env.HME_PROXY_STRIP_NON_ASCII === "1";

const BANNER = "[devil-possessed agent attempted DDoC spam. Redacted in the "
  + "almighty name of our lord and savior, Jesus Christ.]";

const NON_ASCII_RE = /[^\x09\x0A\x0D\x20-\x7E]/g;
const FOREIGN_RATIO = 0.10;
const FOREIGN_ABS = 3;

function _countNonAscii(s) {
  NON_ASCII_RE.lastIndex = 0;
  const m = s.match(NON_ASCII_RE);
  return m ? m.length : 0;
}

function _ctxSet(ctx, key) {
  let s = ctx && ctx.get && ctx.get(key);
  if (!s) { s = new Set(); if (ctx && ctx.set) ctx.set(key, s); }
  return s;
}

// Scrub one prose field. Returns the new string, or null to DROP the delta
// (a later contaminated delta in an already-bannered block).
function _scrubField(value, index, ctx) {
  const folded = normalizeToAscii(value);
  const n = _countNonAscii(folded);
  if (n === 0) return folded;                       // clean (maybe typography-folded)
  const dense = n >= FOREIGN_ABS || (n / (folded.length || 1)) > FOREIGN_RATIO;
  if (!dense) return folded.replace(NON_ASCII_RE, ""); // strip sparse stray inline
  const bannered = _ctxSet(ctx, "ascii_bannered_blocks");
  if (bannered.has(index)) return null;             // banner once per block
  bannered.add(index);
  return BANNER;
}

function asciiStripRewrite(eventName, data, ctx) {
  if (!ENABLED) return data;
  if (eventName !== "content_block_delta" || !data || !data.delta) return data;
  const t = data.delta.type;
  // signature_delta passes through untouched -- keeps the block signed.
  if (t === "text_delta" && typeof data.delta.text === "string") {
    const out = _scrubField(data.delta.text, data.index, ctx);
    if (out === null) return null;
    return out === data.delta.text ? data : { ...data, delta: { ...data.delta, text: out } };
  }
  if (t === "thinking_delta" && typeof data.delta.thinking === "string") {
    const out = _scrubField(data.delta.thinking, data.index, ctx);
    if (out === null) return null;
    return out === data.delta.thinking ? data : { ...data, delta: { ...data.delta, thinking: out } };
  }
  return data;
}

module.exports = { asciiStripRewrite, BANNER };
