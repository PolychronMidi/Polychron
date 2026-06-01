"use strict";
// DDoC non-ASCII scrubber.
//

const { normalizeToAscii } = require("../../../src/scripts/pipeline/non-ascii-replacements");
const { couldBeStructuredJsonText, shouldBypassResponseTextRewrite } = require("./structured_output_guard");

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

function _heldText(state) {
  return (state.deltas || []).map((d) => (d && d.delta && typeof d.delta.text === 'string') ? d.delta.text : '').join('');
}

function _rewriteTextDeltaData(data, ctx) {
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

function _rewriteHeldTextEvents(state, ctx) {
  const events = [];
  for (const d of state.deltas || []) {
    const rewritten = _rewriteTextDeltaData(d, ctx);
    if (rewritten) events.push(['content_block_delta', rewritten]);
  }
  return events;
}

function _replayHeldTextEvents(state) {
  return (state.deltas || []).map((d) => ['content_block_delta', d]);
}

function _flushHeldTextForStop(state, stopData, ctx) {
  const assembled = _heldText(state);
  const events = assembled && shouldBypassResponseTextRewrite(assembled)
    ? _replayHeldTextEvents(state)
    : _rewriteHeldTextEvents(state, ctx);
  events.push(['content_block_stop', stopData]);
  return { events };
}

function _flushAllHeldTextBefore(eventName, data, holds, ctx) {
  const events = [];
  for (const [index, state] of Array.from(holds.entries())) {
    holds.delete(index);
    events.push(...(_heldText(state) && shouldBypassResponseTextRewrite(_heldText(state))
      ? _replayHeldTextEvents(state)
      : _rewriteHeldTextEvents(state, ctx)));
  }
  events.push([eventName, data]);
  return { events };
}

function asciiStripRewrite(eventName, data, ctx) {
  if (!ENABLED) return data;
  if (!data) return data;
  const textHolds = _ctxGet(ctx, "ascii_text_holds", () => new Map());
  const bufs = _ctxGet(ctx, "ascii_think_bufs", () => new Map());

  //  TEXT: stream inline unless it might be structured JSON 
  if (eventName === "content_block_start" && data.content_block
      && data.content_block.type === "text") {
    textHolds.set(data.index, { deltas: [], probing: true });
    return data;
  }
  if (eventName === "message_stop" && textHolds.size > 0) {
    return _flushAllHeldTextBefore(eventName, data, textHolds, ctx);
  }
  const textState = (typeof data.index === "number") ? textHolds.get(data.index) : null;
  if (textState) {
    if (eventName === "content_block_delta") {
      if (!data.delta || data.delta.type !== "text_delta" || typeof data.delta.text !== "string") {
        textHolds.delete(data.index);
        const events = _rewriteHeldTextEvents(textState, ctx);
        events.push([eventName, data]);
        return { events };
      }
      if (!textState.probing) return _rewriteTextDeltaData(data, ctx);
      textState.deltas.push(data);
      if (couldBeStructuredJsonText(_heldText(textState))) return null;
      textState.probing = false;
      const events = _rewriteHeldTextEvents(textState, ctx);
      textState.deltas = [];
      return { events };
    }
    if (eventName === "content_block_stop") {
      textHolds.delete(data.index);
      return _flushHeldTextForStop(textState, data, ctx);
    }
  }

  //  THINKING: buffer the whole block, judge at stop 
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

  //  TEXT delta without a start event: legacy inline path 
  if (eventName === "content_block_delta" && data.delta
      && data.delta.type === "text_delta" && typeof data.delta.text === "string") {
    return _rewriteTextDeltaData(data, ctx);
  }

  return data;
}

module.exports = { asciiStripRewrite, BANNER };
