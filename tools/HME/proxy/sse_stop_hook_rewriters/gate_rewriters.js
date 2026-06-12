'use strict';

const { _isStopHookCeremony, _trimSoloRationaleParagraph } = require('./predicates');
const { makeTextBlockBufferedRewriter } = require('./text_block_buffer');
const { recordStrategyEvent } = require('./logging');

function _isContentEvent(eventName) {
  return eventName === 'content_block_start'
    || eventName === 'content_block_delta'
    || eventName === 'content_block_stop';
}

const _stopHookCeremonyStripRewrite = makeTextBlockBufferedRewriter({
  key: 'stop_hook_ceremony_hold',
  shouldBuffer({ ctx }) { return Boolean(ctx.get('priorUserWasDeny')); },
  onStop({ state, ctx }) {
    if (!_isStopHookCeremony(state.text)) return { action: 'replay' };
    ctx.set('stop_hook_truncated', true);
    recordStrategyEvent('stop-hook-ceremony-strip', {
      text_preview: state.text.slice(0, 300),
      assembled_len: state.text.length,
    }, ctx);
    return { action: 'replace', text: '.' };
  },
});

function stopHookCeremonyStripRewrite(eventName, data, ctx) {
  if (ctx.get('stop_hook_truncated') && _isContentEvent(eventName)) return null;
  return _stopHookCeremonyStripRewrite(eventName, data, ctx);
}

const _fpGateMarkerRewrite = makeTextBlockBufferedRewriter({
  key: 'fp_gate_hold',
  shouldBuffer({ ctx }) { return Boolean(ctx.get('priorUserWasDeny')); },
  onStop({ state, ctx }) {
    if (ctx.get('fp_gate_first_block_done')) return { action: 'replay' };
    ctx.set('fp_gate_first_block_done', true);
    if (/\[FP-CHECK:\s*yes\]/i.test(state.text)) {
      ctx.set('fp_gate_truncated', true);
      recordStrategyEvent('fp-gate-marker', {
        verdict: 'yes',
        assembled_len: state.text.length,
        preview: state.text.slice(0, 200),
      }, ctx);
      return { action: 'replace', text: '`[fp-gate: yes -- silent ack of false-positive flag]`' };
    }
    const noMatch = state.text.match(/^[\s]*\[FP-CHECK:\s*no\]\s*\n?/i);
    if (!noMatch) return { action: 'replay' };
    const stripped = state.text.slice(noMatch[0].length);
    recordStrategyEvent('fp-gate-marker', { verdict: 'no', kept_len: stripped.length }, ctx);
    return { action: 'replace', text: stripped };
  },
});

function fpGateMarkerRewrite(eventName, data, ctx) {
  if (ctx.get('fp_gate_truncated') && _isContentEvent(eventName)) return null;
  return _fpGateMarkerRewrite(eventName, data, ctx);
}

const _soloRationaleTrimRewrite = makeTextBlockBufferedRewriter({
  key: 'srt_hold',
  shouldBuffer({ ctx }) { return Boolean(ctx.get('priorUserWasDeny')); },
  onStop({ state, ctx }) {
    const { text: trimmed, trimmed: didTrim } = _trimSoloRationaleParagraph(state.text);
    if (!didTrim) return { action: 'replay' };
    recordStrategyEvent('solo-rationale-trim', {
      original_len: state.text.length,
      trimmed_len: trimmed.length,
      removed_len: state.text.length - trimmed.length,
      removed_preview: state.text.slice(trimmed.length).slice(0, 200),
    }, ctx);
    return { action: 'replace', text: trimmed };
  },
});

function soloRationaleTrimRewrite(eventName, data, ctx) {
  return _soloRationaleTrimRewrite(eventName, data, ctx);
}

module.exports = {
  stopHookCeremonyStripRewrite,
  fpGateMarkerRewrite,
  soloRationaleTrimRewrite,
};
