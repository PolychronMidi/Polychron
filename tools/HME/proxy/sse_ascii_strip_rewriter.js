"use strict";
// DDoC non-ASCII scrubber -- VISIBLE TEXT CHANNEL ONLY.
//
// thinking_delta is passed through 100% verbatim, and so is its
// signature_delta. This is not a compromise -- it is forced by the protocol:
// an Anthropic thinking block carries a signature that cryptographically seals
// its EXACT text. Any edit to the thinking text (rewrite, banner, placeholder)
// makes the signature mismatch; dropping the signature leaves an unsigned
// thinking block. BOTH cause the client to reject the whole message
// ("tool call could not be parsed"). So thinking is never touched here.
//
// text_delta (the user-visible answer): typography is folded to ASCII via the
// shared table; a sparse stray non-ASCII char is stripped inline; a delta that
// is dense foreign script is replaced by the banner (once per block).

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

function asciiStripRewrite(eventName, data, ctx) {
  if (!ENABLED) return data;
  if (eventName !== "content_block_delta" || !data || !data.delta) return data;
  if (data.delta.type !== "text_delta" || typeof data.delta.text !== "string") return data;

  const folded = normalizeToAscii(data.delta.text);
  const n = _countNonAscii(folded);
  if (n === 0) {
    return folded === data.delta.text ? data
      : { ...data, delta: { ...data.delta, text: folded } };
  }
  const dense = n >= FOREIGN_ABS || (n / (folded.length || 1)) > FOREIGN_RATIO;
  if (!dense) {
    return { ...data, delta: { ...data.delta, text: folded.replace(NON_ASCII_RE, "") } };
  }
  const bannered = _ctxSet(ctx, "ascii_text_bannered");
  if (bannered.has(data.index)) return null;
  bannered.add(data.index);
  return { ...data, delta: { ...data.delta, text: BANNER } };
}

module.exports = { asciiStripRewrite, BANNER };
