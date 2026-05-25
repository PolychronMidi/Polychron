'use strict';

const { _isBareAck, _isHallucinatedTurnPrefix, _isCeremonyDodge } = require('./predicates');
const {
  makeTextBlockBufferedRewriter,
  replayBufferedEvents,
} = require('./text_block_buffer');
const { recordStrategyEvent } = require('./logging');

const _hookUiEchoStripRewrite = makeTextBlockBufferedRewriter({
  key: 'hook_ui_echo_text_hold',
  onStop({ state, data, ctx }) {
    const { stripHookUiEchoText } = require('../hook_ui_echo_guard');
    const { PROJECT_ROOT } = require('../shared');
    const root = ctx.get('projectRoot') || PROJECT_ROOT;
    const stats = ctx.get('hookUiEchoStats') || {};
    ctx.set('hookUiEchoStats', stats);
    const stripped = stripHookUiEchoText(state.text, stats, { projectRoot: root, source: 'response-sse' });
    if (!stripped.trim()) return { action: 'drop' };
    return { action: 'replace', text: stripped, stopData: data };
  },
});

const _ackStripRewrite = makeTextBlockBufferedRewriter({
  key: 'text_hold',
  shouldBuffer({ ctx }) { return Boolean(ctx.get('priorUserWasDeny')); },
  onStop({ state, ctx }) {
    if (!_isBareAck(state.text)) return { action: 'replay' };
    recordStrategyEvent('bare-ack-strip', {
      path: 'sse',
      context: 'cascade-after-deny',
      text_preview: state.text.slice(0, 40),
    }, ctx);
    return { action: 'drop' };
  },
});

function ackStripRewrite(eventName, data, ctx) {
  return _ackStripRewrite(eventName, data, ctx);
}

const _TURN_PREFIX_LOOKAHEAD = 64;

function _turnPrefixKind(text) {
  if (_isHallucinatedTurnPrefix(text)) return 'turn_prefix';
  if (_isCeremonyDodge(text)) return 'ceremony_dodge';
  return '';
}

function _logTurnPrefix(kind, text, ctx) {
  recordStrategyEvent('hallucinated-turn-prefix-strip', {
    kind,
    text_preview: text.slice(0, 100),
  }, ctx);
}

const _hallucinatedTurnPrefixStripRewrite = makeTextBlockBufferedRewriter({
  key: 'turn_prefix_text_hold',
  onDelta({ state, ctx }) {
    if (state.text.length < _TURN_PREFIX_LOOKAHEAD) return undefined;
    const kind = _turnPrefixKind(state.text);
    if (kind) {
      _logTurnPrefix(kind, state.text, ctx);
      return { action: 'drop-until-stop' };
    }
    return { action: 'flush' };
  },
  onStop({ state, data, ctx }) {
    const kind = _turnPrefixKind(state.text);
    if (!kind) return { events: replayBufferedEvents(state, data) };
    _logTurnPrefix(kind, state.text, ctx);
    return { action: 'drop' };
  },
});

function hallucinatedTurnPrefixStripRewrite(eventName, data, ctx) {
  return _hallucinatedTurnPrefixStripRewrite(eventName, data, ctx);
}

module.exports = {
  hookUiEchoStripRewrite,
  ackStripRewrite,
  hallucinatedTurnPrefixStripRewrite,
};
