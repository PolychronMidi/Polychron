const { shouldBypassResponseTextRewrite } = require('../structured_output_guard');

function _holdsFor(ctx, key) {
  let holds = ctx.get(key);
  if (!holds) { holds = new Map(); ctx.set(key, holds); }
  return holds;
}

function textDeltaEvent(index, text) {
  return ['content_block_delta', {
    type: 'content_block_delta',
    index,
    delta: { type: 'text_delta', text },
  }];
}

function replayBufferedEvents(state, stopData = null) {
  const events = [['content_block_start', state.startData]];
  for (const d of state.deltas) events.push(['content_block_delta', d]);
  if (stopData) events.push(['content_block_stop', stopData]);
  return events;
}

function replaceBufferedTextEvents(state, stopData, text) {
  const events = [['content_block_start', state.startData]];
  if (text) events.push(textDeltaEvent(stopData.index, text));
  events.push(['content_block_stop', stopData]);
  return events;
}

function flushHeldEvents(holds, trailingEvent = null) {
  const events = [];
  for (const [index, state] of Array.from(holds.entries())) {
    holds.delete(index);
    if (!state.dropping) events.push(...replayBufferedEvents(state));
  }
  if (trailingEvent) events.push(trailingEvent);
  return events;
}

function _shouldBypass(state, enableGuard) {
  return enableGuard !== false && shouldBypassResponseTextRewrite(state && state.text);
}

function _applyDecision(decision, env) {
  if (!decision) return undefined;
  const { state, stopData, holds, index } = env;
  if (decision.events) return { events: decision.events };
  if (decision.action === 'drop') return null;
  if (decision.action === 'drop-until-stop') { state.dropping = true; return null; }
  if (decision.action === 'flush') {
    holds.delete(index);
    return { events: replayBufferedEvents(state) };
  }
  if (decision.action === 'replace') return { events: replaceBufferedTextEvents(state, stopData, decision.text || '') };
  if (decision.action === 'replay') return { events: replayBufferedEvents(state, stopData) };
  return undefined;
}

function _flushBeforeUnexpectedDelta(eventName, data, holds) {
  const state = holds.get(data.index);
  if (!state) return data;
  if (state.dropping) return null;
  holds.delete(data.index);
  return { events: [...replayBufferedEvents(state), [eventName, data]] };
}

function makeTextBlockBufferedRewriter({ key, shouldBuffer, onDelta, onStop, structuredJsonGuard = true }) {
  return function textBlockBufferedRewrite(eventName, data, ctx) {
    const holds = _holdsFor(ctx, key);
    if (eventName === 'message_stop' && data && holds.size > 0) {
      return { events: flushHeldEvents(holds, [eventName, data]) };
    }
    if (eventName === 'content_block_start' && data && data.content_block && data.content_block.type === 'text') {
      if (shouldBuffer && !shouldBuffer({ data, ctx })) return data;
      holds.set(data.index, { startData: data, deltas: [], text: '' });
      return null;
    }
    if (eventName === 'content_block_delta' && data) {
      if (!data.delta || data.delta.type !== 'text_delta') return _flushBeforeUnexpectedDelta(eventName, data, holds);
      const state = holds.get(data.index);
      if (!state) return data;
      if (state.dropping) return null;
      state.deltas.push(data);
      state.text += data.delta.text || '';
      const decision = onDelta ? onDelta({ state, data, ctx }) : undefined;
      const out = _applyDecision(decision, { state, data, ctx, holds, index: data.index });
      return out === undefined ? null : out;
    }
    if (eventName === 'content_block_stop' && data) {
      const state = holds.get(data.index);
      if (!state) return data;
      holds.delete(data.index);
      if (state.dropping) return null;
      const decision = onStop ? onStop({ state, data, ctx }) : undefined;
      const out = _applyDecision(decision || { action: 'replay' }, {
        state,
        data,
        ctx,
        holds,
        stopData: data,
        index: data.index,
      });
      return out === undefined ? { events: replayBufferedEvents(state, data) } : out;
    }
    return data;
  };
}

module.exports = {
  flushHeldEvents,
  makeTextBlockBufferedRewriter,
  replayBufferedEvents,
  replaceBufferedTextEvents,
  textDeltaEvent,
};
