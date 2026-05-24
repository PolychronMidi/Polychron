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

function ctxGet(ctx, key) {
  if (ctx && typeof ctx.get === 'function') return ctx.get(key);
  return ctx ? ctx[key] : undefined;
}

function ctxSet(ctx, key, value) {
  if (!ctx) return;
  if (typeof ctx.set === 'function') ctx.set(key, value);
  else ctx[key] = value;
}

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
    return changedText(text, '`[fp-gate: yes -- silent ack of false-positive flag]`', { final: true });
  }
  const noMatch = text.match(/^[\s]*\[FP-CHECK:\s*no\]\s*\n?/i);
  if (!noMatch) return changedText(text, text);
  return changedText(text, text.slice(noMatch[0].length));
}

function stopHookCeremonyTextRewrite(text, ctx) {
  if (!ctxGet(ctx, 'priorUserWasDeny') || !_isStopHookCeremony(text)) return changedText(text, text);
  return changedText(text, '.', { final: true });
}

function turnPrefixTextRewrite(text) {
  if (_isHallucinatedTurnPrefix(text) || _isCeremonyDodge(text)) {
    return changedText(text, '', { final: true });
  }
  return changedText(text, text);
}

function bareAckTextRewrite(text, ctx) {
  if (!ctxGet(ctx, 'priorUserWasDeny') || !_isBareAck(text)) return changedText(text, text);
  return changedText(text, '', { final: true });
}

function soloRationaleTextRewrite(text, ctx) {
  if (!ctxGet(ctx, 'priorUserWasDeny')) return changedText(text, text);
  const result = _trimSoloRationaleParagraph(text);
  return changedText(text, result.text, { trimmed: result.trimmed });
}

const hookUiEchoStripRewriter = Object.freeze({
  name: 'hook-ui-echo-strip',
  slot: 'pre-tool',
  rewrite: hookUiEchoStripRewrite,
  rewriteText: hookUiEchoTextRewrite,
});
const fpGateMarkerRewriter = Object.freeze({
  name: 'fp-gate-marker',
  slot: 'pre-tool',
  rewrite: fpGateMarkerRewrite,
  rewriteText: fpGateMarkerTextRewrite,
});
const stopHookCeremonyStripRewriter = Object.freeze({
  name: 'stop-hook-ceremony-strip',
  slot: 'pre-tool',
  rewrite: stopHookCeremonyStripRewrite,
  rewriteText: stopHookCeremonyTextRewrite,
});
const hallucinatedTurnPrefixStripRewriter = Object.freeze({
  name: 'hallucinated-turn-prefix-strip',
  slot: 'pre-tool',
  rewrite: hallucinatedTurnPrefixStripRewrite,
  rewriteText: turnPrefixTextRewrite,
});
const bareAckStripRewriter = Object.freeze({
  name: 'bare-ack-strip',
  slot: 'post-tool-pre-slop',
  rewrite: ackStripRewrite,
  rewriteText: bareAckTextRewrite,
});
const soloRationaleTrimRewriter = Object.freeze({
  name: 'solo-rationale-trim',
  slot: 'post-slop',
  rewrite: soloRationaleTrimRewrite,
  rewriteText: soloRationaleTextRewrite,
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

function recordRewrite(name, next, ctx) {
  const records = ctxGet(ctx, 'stop_hook_text_rewrites') || [];
  records.push({ name, changed: true, final: Boolean(next.final) });
  ctxSet(ctx, 'stop_hook_text_rewrites', records);
}

function rewriteStopHookText(text, ctx, slot = null) {
  let current = String(text || '');
  for (const rewriter of STOP_HOOK_REWRITERS) {
    if (slot && rewriter.slot !== slot) continue;
    if (typeof rewriter.rewriteText !== 'function') continue;
    const next = rewriter.rewriteText(current, ctx);
    if (!next || !next.changed) continue;
    current = next.text;
    recordRewrite(rewriter.name, next, ctx);
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
