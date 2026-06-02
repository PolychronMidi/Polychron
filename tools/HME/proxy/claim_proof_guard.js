'use strict';

const DONE_RE = /\b(done|fixed|complete|all\s+(?:set|green|passed)|nothing\s+missed)\b/i;
const ABSOLUTE_RE = /\b(all|every|never|always|guaranteed)\b/i;

function classifyClaim(text) {
  const t = String(text || '');
  if (DONE_RE.test(t)) return 'completion';
  if (ABSOLUTE_RE.test(t)) return 'absolute';
  if (/\b(likely|maybe|hypothesis|suspect)\b/i.test(t)) return 'hypothesis';
  return 'ordinary';
}

function hasProof(events = [], claimClass = 'ordinary') {
  if (claimClass === 'ordinary' || claimClass === 'hypothesis') return true;
  return events.some((ev) => ev && ['test', 'resolver', 'policy_decision'].includes(ev.kind)
    && Array.isArray(ev.evidence) && ev.evidence.length > 0
    && ['executed', 'observed', 'policy', 'derived'].includes(ev.proof_class));
}

function evaluateClaim(text, events = []) {
  const claimClass = classifyClaim(text);
  const supported = hasProof(events, claimClass);
  return {
    claimClass,
    supported,
    action: supported ? 'allow' : (claimClass === 'absolute' ? 'soften' : 'block'),
    reason: supported ? '' : `${claimClass} claim lacks same-turn proof event`,
  };
}

module.exports = { classifyClaim, hasProof, evaluateClaim };
