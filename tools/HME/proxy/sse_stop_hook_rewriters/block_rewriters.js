'use strict';

const { _isBareAck, _isHallucinatedTurnPrefix, _isCeremonyDodge } = require('./predicates');

function hookUiEchoStripRewrite(eventName, data, ctx) {
  const key = 'hook_ui_echo_text_hold';
  let holds = ctx.get(key);
  if (!holds) { holds = new Map(); ctx.set(key, holds); }

  if (eventName === 'content_block_start' && data && data.content_block && data.content_block.type === 'text') {
    holds.set(data.index, { startData: data, deltas: [], text: '' });
    return null;
  }
  if (eventName === 'content_block_delta' && data && data.delta && data.delta.type === 'text_delta') {
    const state = holds.get(data.index);
    if (!state) return data;
    state.deltas.push(data);
    state.text += data.delta.text || '';
    return null;
  }
  if (eventName === 'content_block_stop' && data) {
    const state = holds.get(data.index);
    if (!state) return data;
    holds.delete(data.index);
    const { stripHookUiEchoText } = require('../hook_ui_echo_guard');
    const { PROJECT_ROOT } = require('../shared');
    const root = ctx.get('projectRoot') || PROJECT_ROOT;
    const stats = ctx.get('hookUiEchoStats') || {};
    ctx.set('hookUiEchoStats', stats);
    const stripped = stripHookUiEchoText(state.text, stats, { projectRoot: root, source: 'response-sse' });
    if (!stripped.trim()) return null;
    const events = [['content_block_start', state.startData]];
    events.push(['content_block_delta', { type: 'content_block_delta', index: data.index, delta: { type: 'text_delta', text: stripped } }]);
    events.push(['content_block_stop', data]);
    return { events };
  }
  return data;
}

function ackStripRewrite(eventName, data, ctx) {
  // Only active when the request payload indicated the prior user
  // message was a hook-deny payload. Set by the proxy before passing
  // events through the rewriter chain.
  if (!ctx.get('priorUserWasDeny')) return data;

  const key = 'text_hold';
  let holds = ctx.get(key);
  if (!holds) { holds = new Map(); ctx.set(key, holds); }

  if (eventName === 'content_block_start' && data && data.content_block && data.content_block.type === 'text') {
    holds.set(data.index, { buffered: [data] });
    return null;  // hold the start event
  }

  if (eventName === 'content_block_delta' && data && data.delta && data.delta.type === 'text_delta') {
    const state = holds.get(data.index);
    if (!state) return data;
    state.buffered.push(['content_block_delta', data]);
    return null;  // hold the delta event
  }

  if (eventName === 'content_block_stop' && data) {
    const state = holds.get(data.index);
    if (!state) return data;
    holds.delete(data.index);
    // Reconstruct full text from held delta events.
    let text = '';
    for (const ev of state.buffered) {
      if (Array.isArray(ev) && ev[0] === 'content_block_delta') {
        const d = ev[1];
        if (d && d.delta && typeof d.delta.text === 'string') text += d.delta.text;
      }
    }
    if (_isBareAck(text)) {
      // Log stats outside errors.log so stripped spam does not re-surface.
      try {
        const fs = require('fs');
        const path = require('path');
        const { PROJECT_ROOT } = require('../shared');
        fs.appendFileSync(
          path.join(PROJECT_ROOT, 'log', 'hme-bare-ack-strips.jsonl'),
          JSON.stringify({
            ts: new Date().toISOString(),
            path: 'sse',
            context: 'cascade-after-deny',
            text_preview: text.slice(0, 40),
          }) + '\n',
        );
      } catch (_e) { /* stat is best-effort */ }
      return null;
    }
    // Not a bare ack -- replay the held events as a list, then the stop.
    const events = [];
    // First item in state.buffered was the content_block_start data
    // (stored bare, not as [name, data] tuple). Re-emit as start event.
    events.push(['content_block_start', state.buffered[0]]);
    for (let i = 1; i < state.buffered.length; i++) {
      events.push(state.buffered[i]);
    }
    events.push(['content_block_stop', data]);
    return { events };
  }

  return data;
}

// Drop fake turn prefixes; decide after a short lookahead, then stream.
const _TURN_PREFIX_LOOKAHEAD = 64;

function hallucinatedTurnPrefixStripRewrite(eventName, data, ctx) {
  const key = 'turn_prefix_text_hold';
  let holds = ctx.get(key);
  if (!holds) { holds = new Map(); ctx.set(key, holds); }

  if (eventName === 'content_block_start' && data && data.content_block && data.content_block.type === 'text') {
    holds.set(data.index, { startData: data, deltas: [], decided: false, accumulated: '' });
    return null;
  }
  if (eventName === 'content_block_delta' && data && data.delta && data.delta.type === 'text_delta') {
    const state = holds.get(data.index);
    if (!state) return data;
    if (state.decided) return data;
    state.deltas.push(data);
    state.accumulated += data.delta.text || '';
    if (state.accumulated.length < _TURN_PREFIX_LOOKAHEAD) return null;
    const isPrefix = _isHallucinatedTurnPrefix(state.accumulated);
    const isDodge = _isCeremonyDodge(state.accumulated);
    if (isPrefix || isDodge) {
      try {
        const fs = require('fs');
        const path = require('path');
        const { PROJECT_ROOT } = require('../shared');
        fs.appendFileSync(
          path.join(PROJECT_ROOT, 'log', 'hme-turn-prefix-strips.jsonl'),
          JSON.stringify({
            ts: new Date().toISOString(),
            kind: isPrefix ? 'turn_prefix' : 'ceremony_dodge',
            text_preview: state.accumulated.slice(0, 100),
          }) + '\n',
        );
      } catch (_e) { /* stat is best-effort */ }
      state.decided = true;
      state.dropping = true;
      return null;
    }
    state.decided = true;
    const events = [['content_block_start', state.startData]];
    for (const d of state.deltas) events.push(['content_block_delta', d]);
    return { events };
  }
  if (eventName === 'content_block_stop' && data) {
    const state = holds.get(data.index);
    if (!state) return data;
    holds.delete(data.index);
    if (state.dropping) return null;
    if (state.decided) return data;
    let assembled = state.accumulated;
    const isPrefix = _isHallucinatedTurnPrefix(assembled);
    const isDodge = _isCeremonyDodge(assembled);
    if (isPrefix || isDodge) {
      // Best-effort stat (separate log; never errors.log).
      try {
        const fs = require('fs');
        const path = require('path');
        const { PROJECT_ROOT } = require('../shared');
        fs.appendFileSync(
          path.join(PROJECT_ROOT, 'log', 'hme-turn-prefix-strips.jsonl'),
          JSON.stringify({
            ts: new Date().toISOString(),
            kind: isPrefix ? 'turn_prefix' : 'ceremony_dodge',
            text_preview: assembled.slice(0, 100),
          }) + '\n',
        );
      } catch (_e) { /* stat is best-effort */ }
      return null;  // drop the whole block
    }
    // Not a hallucinated prefix -- replay held events through.
    const events = [['content_block_start', state.startData]];
    for (const d of state.deltas) {
      events.push(['content_block_delta', d]);
    }
    events.push(['content_block_stop', data]);
    return { events };
  }
  return data;
}


module.exports = {
  hookUiEchoStripRewrite,
  ackStripRewrite,
  hallucinatedTurnPrefixStripRewrite,
};
