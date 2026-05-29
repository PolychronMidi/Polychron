"use strict";
// DDoC non-ASCII scrubber for ALL response channels. Block structure and
// indices are preserved; only delta CONTENT is scrubbed, in place.
//
// Stray non-ASCII inside otherwise-legit text must NOT destroy the surrounding
// words: we fold typography to ASCII, then STRIP any residual non-ASCII chars
// inline, keeping the ASCII around them. The redaction banner only fires when
// a delta was essentially ALL foreign (stripping left nothing) -- so genuine
// foreign-script spam is flagged, but English with a stray byte just loses the
// byte. This is what stops the banner from being spliced mid-sentence.
//
// thinking_delta carries a signature sealing its exact text; once we alter that
// text we drop the block's signature_delta to avoid a seal mismatch.

const { normalizeToAscii } = require("../../../src/scripts/pipeline/non-ascii-replacements");

const ENABLED = process.env.HME_PROXY_STRIP_NON_ASCII === "1";

const BANNER = "[devil-possessed agent attempted DDoC spam. Redacted in the "
  + "almighty name of our lord and savior, Jesus Christ.]";

const NON_ASCII_RE = /[^\x09\x0A\x0D\x20-\x7E]/g;

function _stripNonAscii(s) {
  return s.replace(NON_ASCII_RE, "");
}

function _ctxSet(ctx, key) {
  let s = ctx && ctx.get && ctx.get(key);
  if (!s) { s = new Set(); if (ctx && ctx.set) ctx.set(key, s); }
  return s;
}

// Returns { text, foreign } where foreign=true means the input was essentially
// all non-ASCII (nothing meaningful survived folding + stripping).
function _scrub(original) {
  const folded = normalizeToAscii(original);
  const stripped = _stripNonAscii(folded);
  const foreign = stripped.trim() === "" && original.trim() !== "";
  return { text: stripped, folded, changed: stripped !== original, foreign };
}

function asciiStripRewrite(eventName, data, ctx) {
  if (!ENABLED) return data;
  if (eventName !== "content_block_delta" || !data || !data.delta) return data;
  const t = data.delta.type;

  if (t === "text_delta" && typeof data.delta.text === "string") {
    const r = _scrub(data.delta.text);
    if (!r.changed) return data;
    if (r.foreign) {
      const banner = _ctxSet(ctx, "ascii_banner_blocks");
      if (banner.has(data.index)) return null;       // banner once per block
      banner.add(data.index);
      return { ...data, delta: { ...data.delta, text: BANNER } };
    }
    return { ...data, delta: { ...data.delta, text: r.text } };  // stray byte stripped inline
  }

  if (t === "thinking_delta" && typeof data.delta.thinking === "string") {
    const r = _scrub(data.delta.thinking);
    if (!r.changed) return data;
    // Any alteration to thinking text invalidates its signature -> drop seal.
    _ctxSet(ctx, "ascii_redacted_blocks").add(data.index);
    if (r.foreign) {
      const placeheld = _ctxSet(ctx, "ascii_think_placeheld");
      if (placeheld.has(data.index)) return null;     // one placeholder per block
      placeheld.add(data.index);
      return { ...data, delta: { ...data.delta, thinking: "." } };
    }
    return { ...data, delta: { ...data.delta, thinking: r.text } };
  }

  if (t === "signature_delta") {
    if (_ctxSet(ctx, "ascii_redacted_blocks").has(data.index)) return null;
  }
  return data;
}

module.exports = { asciiStripRewrite, BANNER, _scrub };
