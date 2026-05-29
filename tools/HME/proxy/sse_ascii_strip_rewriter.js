"use strict";
// DDoC scrubber. A non-ASCII byte is the MARKER that a spam span is present;
// the surrounding mangled ASCII ("Th.", "B", ".jstrong th mc") is spam too, so
// stripping only the non-ASCII chars leaves garbage. Instead we drop the WHOLE
// contaminated section.
//
// thinking_delta: the block is BUFFERED (start..stop). If any delta, after
//   folding legit typography to ASCII, still has non-ASCII, the ENTIRE block
//   content is replaced with one banner delta and its signature is dropped
//   (the seal no longer matches). Block start/stop stay intact so indices and
//   the client block table are preserved. Clean blocks flush verbatim (with
//   typography folded).
// text_delta: visible answer streams normally; typography folded inline, and a
//   delta that is dense foreign script is replaced by the banner (once/block).

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

function _ctxGet(ctx, key, make) {
  let v = ctx && ctx.get && ctx.get(key);
  if (v === undefined) { v = make(); if (ctx && ctx.set) ctx.set(key, v); }
  return v;
}

function _bannerDelta(index) {
  return ["content_block_delta",
    { type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: BANNER } }];
}

function asciiStripRewrite(eventName, data, ctx) {
  if (!ENABLED) return data;
  if (!data) return data;
  const buffers = _ctxGet(ctx, "ascii_think_buffers", () => new Map());

  // --- buffer thinking blocks start..stop, decide at stop ---
  if (eventName === "content_block_start" && data.content_block
      && data.content_block.type === "thinking") {
    buffers.set(data.index, { start: data, deltas: [], foreign: false });
    return null;
  }
  const buf = (typeof data.index === "number") ? buffers.get(data.index) : null;
  if (buf) {
    if (eventName === "content_block_delta" && data.delta
        && data.delta.type === "thinking_delta"
        && typeof data.delta.thinking === "string") {
      const folded = normalizeToAscii(data.delta.thinking);
      if (_countNonAscii(folded) > 0) buf.foreign = true;
      buf.deltas.push(["content_block_delta",
        { ...data, delta: { ...data.delta, thinking: folded } }]);
      return null;
    }
    if (eventName === "content_block_delta" && data.delta
        && data.delta.type === "signature_delta") {
      buf.signature = data;            // held; dropped if block is contaminated
      return null;
    }
    if (eventName === "content_block_stop") {
      buffers.delete(data.index);
      const out = [["content_block_start", buf.start]];
      if (buf.foreign) {
        // Drop the entire contaminated section: one banner, no signature.
        out.push(_bannerDelta(data.index));
      } else {
        out.push(...buf.deltas);
        if (buf.signature) out.push(["content_block_delta", buf.signature]);
      }
      out.push(["content_block_stop", data]);
      return { events: out };
    }
    // any other event mid-block: hold it in order
    buf.deltas.push([eventName, data]);
    return null;
  }

  // --- visible text channel (streams inline) ---
  if (eventName === "content_block_delta" && data.delta
      && data.delta.type === "text_delta" && typeof data.delta.text === "string") {
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
    const bannered = _ctxGet(ctx, "ascii_text_bannered", () => new Set());
    if (bannered.has(data.index)) return null;
    bannered.add(data.index);
    return { ...data, delta: { ...data.delta, text: BANNER } };
  }

  return data;
}

module.exports = { asciiStripRewrite, BANNER };
