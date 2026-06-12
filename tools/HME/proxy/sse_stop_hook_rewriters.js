'use strict';

const {
  hookUiEchoStripRewrite,
  ackStripRewrite,
  hallucinatedTurnPrefixStripRewrite,
} = require('./sse_stop_hook_rewriters/block_rewriters');
const {
  stopHookCeremonyStripRewrite,
  fpGateMarkerRewrite,
  soloRationaleTrimRewrite,
} = require('./sse_stop_hook_rewriters/gate_rewriters');
const {
  _isBareAck,
  _isHallucinatedTurnPrefix,
  _isCeremonyDodge,
  _isStopHookCeremony,
  _trimSoloRationaleParagraph,
} = require('./sse_stop_hook_rewriters/predicates');
const {
  STRATEGY_LOG_FILES,
  ctxGet,
  ctxSet,
  recordRewrite,
  recordStrategyEvent,
} = require('./sse_stop_hook_rewriters/logging');

function changedText(text, next, extra = {}) {
  return { changed: next !== text, text: next, ...extra };
}

function hookUiEchoTextRewrite(text, ctx) {
  const { stripHookUiEchoText } = require('./hook_ui_echo_guard');
  const { PROJECT_ROOT } = require('./shared');
  const stats = ctxGet(ctx, 'hookUiEchoStats') || {};
  ctxSet(ctx, 'hookUiEchoStats', stats);
  const root = ctxGet(ctx, 'projectRoot') || PROJECT_ROOT;
  return changedText(text, stripHookUiEchoText(text, stats, { projectRoot: root, source: 'response-text' }));
}

function fpGateMarkerTextRewrite(text, ctx) {
  if (!ctxGet(ctx, 'priorUserWasDeny')) return changedText(text, text);
  if (ctxGet(ctx, 'fp_gate_first_block_done')) return changedText(text, text);
  ctxSet(ctx, 'fp_gate_first_block_done', true);
  if (/\[FP-CHECK:\s*yes\]/i.test(text)) {
    return changedText(text, '`[fp-gate: yes -- silent ack of false-positive flag]`', { final: true, verdict: 'yes', assembled_len: text.length, preview: text.slice(0, 200) });
  }
  const noMatch = text.match(/^[\s]*\[FP-CHECK:\s*no\]\s*\n?/i);
  if (!noMatch) return changedText(text, text);
  return changedText(text, text.slice(noMatch[0].length), { verdict: 'no', kept_len: text.length - noMatch[0].length });
}

function stopHookCeremonyTextRewrite(text, ctx) {
  if (!ctxGet(ctx, 'priorUserWasDeny') || !_isStopHookCeremony(text)) return changedText(text, text);
  return changedText(text, '.', { final: true, text_preview: text.slice(0, 300), assembled_len: text.length });
}

function turnPrefixTextRewrite(text) {
  if (_isHallucinatedTurnPrefix(text) || _isCeremonyDodge(text)) {
    return changedText(text, '', { final: true, kind: _isHallucinatedTurnPrefix(text) ? 'turn_prefix' : 'ceremony_dodge', text_preview: text.slice(0, 100) });
  }
  return changedText(text, text);
}

function bareAckTextRewrite(text, ctx) {
  if (!ctxGet(ctx, 'priorUserWasDeny') || !_isBareAck(text)) return changedText(text, text);
  return changedText(text, '', { final: true, context: 'cascade-after-deny', text_preview: text.slice(0, 40) });
}

function soloRationaleTextRewrite(text, ctx) {
  if (!ctxGet(ctx, 'priorUserWasDeny')) return changedText(text, text);
  const result = _trimSoloRationaleParagraph(text);
  return changedText(text, result.text, { trimmed: result.trimmed, original_len: text.length, trimmed_len: result.text.length, removed_len: text.length - result.text.length, removed_preview: text.slice(result.text.length).slice(0, 200) });
}

const hookUiEchoStripRewriter = Object.freeze({
  name: 'hook-ui-echo-strip',
  slot: 'pre-tool',
  rewrite: hookUiEchoStripRewrite,
  rewriteText: hookUiEchoTextRewrite,
  logFile: STRATEGY_LOG_FILES['hook-ui-echo-strip'],
});
const fpGateMarkerRewriter = Object.freeze({
  name: 'fp-gate-marker',
  slot: 'pre-tool',
  rewrite: fpGateMarkerRewrite,
  rewriteText: fpGateMarkerTextRewrite,
  logFile: STRATEGY_LOG_FILES['fp-gate-marker'],
});
const stopHookCeremonyStripRewriter = Object.freeze({
  name: 'stop-hook-ceremony-strip',
  slot: 'pre-tool',
  rewrite: stopHookCeremonyStripRewrite,
  rewriteText: stopHookCeremonyTextRewrite,
  logFile: STRATEGY_LOG_FILES['stop-hook-ceremony-strip'],
});
const hallucinatedTurnPrefixStripRewriter = Object.freeze({
  name: 'hallucinated-turn-prefix-strip',
  slot: 'pre-tool',
  rewrite: hallucinatedTurnPrefixStripRewrite,
  rewriteText: turnPrefixTextRewrite,
  logFile: STRATEGY_LOG_FILES['hallucinated-turn-prefix-strip'],
});
const bareAckStripRewriter = Object.freeze({
  name: 'bare-ack-strip',
  slot: 'post-tool-pre-slop',
  rewrite: ackStripRewrite,
  rewriteText: bareAckTextRewrite,
  logFile: STRATEGY_LOG_FILES['bare-ack-strip'],
});
const soloRationaleTrimRewriter = Object.freeze({
  name: 'solo-rationale-trim',
  slot: 'post-slop',
  rewrite: soloRationaleTrimRewrite,
  rewriteText: soloRationaleTextRewrite,
  logFile: STRATEGY_LOG_FILES['solo-rationale-trim'],
});

const STOP_HOOK_REWRITERS = Object.freeze([
  hookUiEchoStripRewriter,
  fpGateMarkerRewriter,
  stopHookCeremonyStripRewriter,
  hallucinatedTurnPrefixStripRewriter,
  bareAckStripRewriter,
  soloRationaleTrimRewriter,
]);
const STOP_HOOK_REWRITER_STRATEGIES = STOP_HOOK_REWRITERS;

function stopHookRewritersForSlot(slot) {
  return STOP_HOOK_REWRITERS
    .filter((strategy) => strategy.slot === slot)
    .map((strategy) => strategy.rewrite);
}


function rewriteStopHookText(text, ctx, slot = null) {
  let current = String(text || '');
  for (const rewriter of STOP_HOOK_REWRITERS) {
    if (slot && rewriter.slot !== slot) continue;
    if (typeof rewriter.rewriteText !== 'function') continue;
    const next = rewriter.rewriteText(current, ctx);
    if (!next || !next.changed) continue;
    current = next.text;
    const { changed: _changed, text: _text, final: _final, ...event } = next;
    recordRewrite(rewriter.name, next, ctx);
    recordStrategyEvent(rewriter.name, { path: 'text', ...event }, ctx);
    if (next.final) break;
  }
  return current;
}

module.exports = {
  STOP_HOOK_REWRITERS,
  STOP_HOOK_REWRITER_STRATEGIES,
  stopHookRewritersForSlot,
  rewriteStopHookText,
  recordRewrite,
  recordStrategyEvent,
  STRATEGY_LOG_FILES,
  hookUiEchoStripRewriter,
  fpGateMarkerRewriter,
  stopHookCeremonyStripRewriter,
  hallucinatedTurnPrefixStripRewriter,
  bareAckStripRewriter,
  soloRationaleTrimRewriter,
  hookUiEchoStripRewrite,
  ackStripRewrite,
  hallucinatedTurnPrefixStripRewrite,
  stopHookCeremonyStripRewrite,
  fpGateMarkerRewrite,
  soloRationaleTrimRewrite,
  _isBareAck,
  _isHallucinatedTurnPrefix,
  _isCeremonyDodge,
  _isStopHookCeremony,
  _trimSoloRationaleParagraph,
};
