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

const STOP_HOOK_REWRITER_STRATEGIES = Object.freeze([
  { name: 'hook-ui-echo-strip', slot: 'pre-tool', rewrite: hookUiEchoStripRewrite },
  { name: 'fp-gate-marker', slot: 'pre-tool', rewrite: fpGateMarkerRewrite },
  { name: 'stop-hook-ceremony-strip', slot: 'pre-tool', rewrite: stopHookCeremonyStripRewrite },
  { name: 'hallucinated-turn-prefix-strip', slot: 'pre-tool', rewrite: hallucinatedTurnPrefixStripRewrite },
  { name: 'bare-ack-strip', slot: 'post-tool-pre-slop', rewrite: ackStripRewrite },
  { name: 'solo-rationale-trim', slot: 'post-slop', rewrite: soloRationaleTrimRewrite },
]);

function stopHookRewritersForSlot(slot) {
  return STOP_HOOK_REWRITER_STRATEGIES
    .filter((strategy) => strategy.slot === slot)
    .map((strategy) => strategy.rewrite);
}

module.exports = {
  STOP_HOOK_REWRITER_STRATEGIES,
  stopHookRewritersForSlot,
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
