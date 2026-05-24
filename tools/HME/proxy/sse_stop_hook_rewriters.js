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
  { name: 'hook-ui-echo-strip', slot: 'before-tools', rewrite: hookUiEchoStripRewrite },
  { name: 'fp-gate-marker', slot: 'before-tools', rewrite: fpGateMarkerRewrite },
  { name: 'stop-hook-ceremony-strip', slot: 'before-tools', rewrite: stopHookCeremonyStripRewrite },
  { name: 'hallucinated-turn-prefix-strip', slot: 'before-tools', rewrite: hallucinatedTurnPrefixStripRewrite },
  { name: 'bare-ack-strip', slot: 'after-tools', rewrite: ackStripRewrite },
  { name: 'solo-rationale-trim', slot: 'after-tools', rewrite: soloRationaleTrimRewrite },
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
