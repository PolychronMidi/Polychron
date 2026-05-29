"use strict";
// DDoC non-ASCII scrubber for ALL response channels.
//
// text_delta (visible): typography folded to ASCII via shared table; genuinely
//   foreign residue is replaced inline with the redaction banner.
// thinking_delta: a thinking block carries a signature sealing its EXACT text,
//   so we cannot rewrite the text in place. Instead we BUFFER the whole block
//   (start..stop) and, if any delta contains foreign residue after folding,
//   DROP the entire block atomically -- start, deltas, signature, stop. A
//   message with no thinking block is valid; dropping avoids both seal
//   mismatch and orphaned (unsigned) blocks. Later block indices shift down by
//   one per dropped block so the content array has no gap.

const { normalizeToAscii } = require("../../../src/scripts/pipeline/non-ascii-replacements");

const ENABLED = process.env.HME_PROXY_STRIP_NON_ASCII === "1";

const BANNER = "[devil-possessed agent attempted DDoC spam. Redacted in the "
  + "almighty name of our lord and savior, Jesus Christ.]";

const NON_ASCII_RE = /[^\x09\x0A\x0D\x20-\x7E]/g;

function _hasNonAscii(s) {
  return typeof s === "string" && NON_ASCII_RE.test(s);
}

function _state(ctx) {
  let st = ctx && ctx.get && ctx.get("ascii_strip_state");
  if (!st) {
    st = { think: new Map(), shift: 0, bannered: new Set() };
    if (ctx && ctx.set) ctx.set("ascii_strip_state", st);
  }
  return st;
}

// Re-index an event's block index down by the running shift.
function _shifted(data, shift) {
  if (shift && typeof data.index === "number") {
    return { ...data, index: data.index - shift };
  }
  return data;
}

function _handleText(data, st) {
  const original = data.delta.text;
  const normalized = normalizeToAscii(original);
  if (!_hasNonAscii(normalized)) {
    const base = _shifted(data, st.shift);
    if (normalized === original) return base;
    return { ...base, delta: { ...base.delta, text: normalized } };
  }
  const idx = data.index;
  if (st.bannered.has(idx)) return null;            // banner once per block
  st.bannered.add(idx);
  const base = _shifted(data, st.shift);
  return { ...base, delta: { ...base.delta, text: BANNER } };
}

function asciiStripRewrite(eventName, data, ctx) {
  if (!ENABLED) return data;
  if (!data) return data;
  const st = _state(ctx);

  // --- thinking block buffering (atomic drop-if-contaminated) ---
  if (eventName === "content_block_start" && data.content_block
      && data.content_block.type === "thinking") {
    st.think.set(data.index, { events: [["content_block_start", data]], dirty: false });
    return null;                                    // hold until stop
  }
  const buffered = (typeof data.index === "number") ? st.think.get(data.index) : null;
  if (buffered) {
    if (eventName === "content_block_delta" && data.delta
        && data.delta.type === "thinking_delta"
        && _hasNonAscii(normalizeToAscii(data.delta.thinking))) {
      buffered.dirty = true;
    }
    buffered.events.push([eventName, data]);
    if (eventName === "content_block_stop") {
      st.think.delete(data.index);
      if (buffered.dirty) { st.shift += 1; return null; }   // drop whole block
      // clean: flush buffered events with shifted indices
      return { events: buffered.events.map(([n, d]) => [n, _shifted(d, st.shift)]) };
    }
    return null;                                    // still buffering
  }

  // --- visible text channel ---
  if (eventName === "content_block_delta" && data.delta
      && data.delta.type === "text_delta" && typeof data.delta.text === "string") {
    return _handleText(data, st);
  }

  // --- everything else: just shift the index if needed ---
  return _shifted(data, st.shift);
}

module.exports = { asciiStripRewrite, BANNER };
