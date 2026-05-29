"use strict";
// DDoC non-ASCII scrubber.
//
// THINKING is buffered whole (start..stop) and judged at stop on the FULL
// block text -- not per-delta. Per-delta decisions leak: a thinking block
// streams as many tiny deltas, and an early delta with only 1-2 foreign chars
// takes the "sparse strip" path and is emitted as a mangled skeleton BEFORE a
// later delta trips the banner threshold. You cannot retract an emitted delta.
// Buffering fixes that: nothing is emitted until the block is whole, so if ANY
// part is foreign the entire block becomes ONE banner delta. The
// signature_delta is KEPT (request-history evidence shows banner-text +
// original signature round-trips 200 OK; DROPPING the signature is what caused
// "tool call could not be parsed").
//
// TEXT (visible answer) streams inline: typography folded to ASCII, sparse
// stray non-ASCII stripped, dense foreign -> banner once per block.

const { normalizeToAscii } = require("../../../src/scripts/pipeline/non-ascii-replacements");

const ENABLED = process.env.HME_PROXY_STRIP_NON_ASCII === "1";

const BANNER = "[devil-possessed agent attempted DDoC spam. Redacted in the "
  + "almighty name of our lord and savior, Jesus Christ.]";

const NON_ASCII_RE = /[^\x09\x0A\x0D\x20-\x7E]/g;
const FOREIGN_ABS = 3;   // >=3 non-ASCII in a TEXT delta => foreign -> banner

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

function _bannerThinkingDelta(index) {
  return ["content_block_delta",
    { type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: BANNER } }];
}

function asciiStripRewrite(eventName, data, ctx) {
  if (!ENABLED) return data;
  if (!data) return data;
  const bufs = _ctxGet(ctx, "ascii_think_bufs", () => new Map());

  // ---- THINKING: buffer the whole block, judge at stop ----
  if (eventName === "content_block_start" && data.content_block
      && data.content_block.type === "thinking") {
    bufs.set(data.index, { start: data, deltas: [], sig: null, foreign: false });
    return null;
  }
  const buf = (typeof data.index === "number") ? bufs.get(data.index) : null;
  if (buf) {
    if (eventName === "content_block_delta" && data.delta) {
      if (data.delta.type === "thinking_delta" && typeof data.delta.thinking === "string") {
        const folded = normalizeToAscii(data.delta.thinking);
        if (_countNonAscii(folded) > 0) buf.foreign = true;
        buf.deltas.push(["content_block_delta", { ...data, delta: { ...data.delta, thinking: folded } }]);
        return null;
      }
      if (data.delta.type === "signature_delta") { buf.sig = data; return null; }
    }
    if (eventName === "content_block_stop") {
      bufs.delete(data.index);
      const out = [["content_block_start", buf.start]];
      if (buf.foreign) {
        out.push(_bannerThinkingDelta(data.index));        // whole block -> one banner
      } else {
        out.push(...buf.deltas);                            // clean -> verbatim (typography folded)
      }
      if (buf.sig) out.push(["content_block_delta", buf.sig]);  // KEEP signature either way
      out.push(["content_block_stop", data]);
      return { events: out };
    }
    // any other mid-block event: hold in order
    buf.deltas.push([eventName, data]);
    return null;
  }

  // ---- TEXT: stream inline ----
  if (eventName === "content_block_delta" && data.delta
      && data.delta.type === "text_delta" && typeof data.delta.text === "string") {
    const bannered = _ctxGet(ctx, "ascii_text_bannered", () => new Set());
    if (bannered.has(data.index)) {
      // once bannered, drop the rest of the block's text (no skeleton leak)
      const folded = normalizeToAscii(data.delta.text);
      if (_countNonAscii(folded) > 0) return null;
      return folded === data.delta.text ? data : { ...data, delta: { ...data.delta, text: folded } };
    }
    const folded = normalizeToAscii(data.delta.text);
    const n = _countNonAscii(folded);
    if (n === 0) return folded === data.delta.text ? data : { ...data, delta: { ...data.delta, text: folded } };
    if (n < FOREIGN_ABS) return { ...data, delta: { ...data.delta, text: folded.replace(NON_ASCII_RE, "") } };
    bannered.add(data.index);
    return { ...data, delta: { ...data.delta, text: BANNER } };
  }

  return data;
}

module.exports = { asciiStripRewrite, BANNER };
