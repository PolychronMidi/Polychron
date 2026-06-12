'use strict';

const BUDGET_AXES = ['tokens', 'latency_ms', 'false_positive', 'false_negative', 'user_attention', 'hook_noise', 'test_runtime_ms', 'branching', 'stale_state'];
const REVIEW_SCALES = ['subtoken', 'function', 'module', 'middleware', 'request_path', 'runtime_ecology', 'portability'];
const AGENT_PATTERNS = [
  { id: 'readless_edit', re: /\bEdit\b|\bWrite\b/, needsEvidence: /\bRead\b|\bGrep\b|\bGlob\b/ },
  { id: 'unsupported_done_claim', re: /\b(done|fixed|complete|all green)\b/i, needsEvidence: /\btest\b|\bpassed\b|\bverified\b/i },
  { id: 'workaround_ceremony', re: /\bjust to satisfy|appease|workaround the hook|silence the alert\b/i },
  { id: 'context_stuffing', re: /\bhuge dump|full transcript|paste everything\b/i },
  { id: 'hypothesis_free_debugging', re: /\btry again|rerun again\b/i, needsEvidence: /\bhypothesis|because|root cause\b/i },
];

function normalizeBudget(input = {}) {
  const cost = {};
  for (const axis of BUDGET_AXES) {
    const n = Number(input[axis] || 0);
    cost[axis] = Number.isFinite(n) && n >= 0 ? n : 0;
  }
  return {
    benefit: String(input.benefit || '').slice(0, 300),
    cost,
    false_positive_risk: String(input.false_positive_risk || 'unknown'),
    noise_emitted: Boolean(input.noise_emitted),
  };
}

function policyFeedback(input = {}) {
  const prevented = Number(input.prevented_failures || 0);
  const noise = Number(input.noise_events || 0);
  const bypassed = Number(input.bypassed || 0);
  const recurred = Number(input.recurred || 0);
  let action = 'keep';
  if (noise > prevented * 2) action = 'narrow';
  if (bypassed > 0) action = 'clarify_intent';
  if (prevented === 0 && noise > 3) action = 'retire';
  if (recurred > prevented) action = 'strengthen_or_move_earlier';
  return { policy: String(input.policy || 'unknown'), action, prevented_failures: prevented, noise_events: noise, bypassed, recurred };
}

function detectAgentPatterns(text, evidenceText = '') {
  const t = String(text || '');
  const ev = String(evidenceText || '');
  return AGENT_PATTERNS.filter((p) => p.re.test(t) && (!p.needsEvidence || !p.needsEvidence.test(ev))).map((p) => p.id);
}

function reviewScales(scope = {}) {
  return REVIEW_SCALES.map((scale) => ({ scale, subject: scope[scale] || '', checked: Boolean(scope[scale]) }));
}

module.exports = { BUDGET_AXES, REVIEW_SCALES, AGENT_PATTERNS, normalizeBudget, policyFeedback, detectAgentPatterns, reviewScales };
