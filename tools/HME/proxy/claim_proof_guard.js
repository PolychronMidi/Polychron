'use strict';

const DONE_RE = /\b(done|fixed|complete|all\s+(?:set|green|passed)|nothing\s+missed)\b/i;
const ABSOLUTE_RE = /\b(all|every|never|always|guaranteed)\b/i;
const COMPLETION_WORD_RE = /\b(done|fixed|complete|completed|pass(?:es|ing|ed)?|green|resolved|working)\b/i;
const ABSOLUTE_QUANT_RE = /\b(all|every|everything|fully|entirely|completely)\b/i;

function classifyClaim(text) {
  const t = String(text || '');
  if (DONE_RE.test(t)) return 'completion';
  if (ABSOLUTE_RE.test(t)) return 'absolute';
  if (/\b(likely|maybe|hypothesis|suspect)\b/i.test(t)) return 'hypothesis';
  return 'ordinary';
}

// An absolute COMPLETION claim is the genuinely over-reaching shape: an absolute
// quantifier paired with a completion word ("all tests pass", "everything is
function isAbsoluteCompletion(text) {
  const t = String(text || '');
  return ABSOLUTE_QUANT_RE.test(t) && COMPLETION_WORD_RE.test(t);
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

module.exports = { classifyClaim, isAbsoluteCompletion, hasProof, evaluateClaim };
