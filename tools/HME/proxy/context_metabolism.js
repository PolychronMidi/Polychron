'use strict';

const state = require('./state_registry');

const STORE = 'statefile_context_metabolism';
const STAGES = ['raw_trace', 'extracted_fact', 'verified_fact', 'durable_invariant', 'compact_doctrine', 'composted'];

function _single(value, limit = 600) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, limit); }
function _num(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }

function normalizeFact(input = {}) {
  const stage = STAGES.includes(input.stage) ? input.stage : 'raw_trace';
  return {
    id: _single(input.id || input.subject || 'fact', 160).replace(/\s+/g, '-'),
    subject: _single(input.subject || '', 240),
    content: _single(input.content || input.text || '', 1000),
    stage,
    usefulness: Math.max(0, Math.min(1, _num(input.usefulness, 0.5))),
    proof_strength: Math.max(0, Math.min(1, _num(input.proof_strength, 0))),
    recency: Math.max(0, Math.min(1, _num(input.recency, 1))),
    source: _single(input.source || '', 240),
    contradicted_by: Array.isArray(input.contradicted_by) ? input.contradicted_by.map((x) => _single(x, 160)).filter(Boolean) : [],
    retrieval_triggers: Array.isArray(input.retrieval_triggers) ? input.retrieval_triggers.map((x) => _single(x, 80)).filter(Boolean) : [],
    delete_when: _single(input.delete_when || '', 240),
  };
}

function metabolismScore(fact) {
  const f = normalizeFact(fact);
  return Number((0.4 * f.usefulness + 0.35 * f.proof_strength + 0.25 * f.recency - 0.2 * Math.min(1, f.contradicted_by.length)).toFixed(4));
}

function nextStage(fact) {
  const f = normalizeFact(fact);
  const score = metabolismScore(f);
  if (score < 0.25 || f.contradicted_by.length) return 'composted';
  if (f.stage === 'raw_trace' && f.proof_strength >= 0.4) return 'extracted_fact';
  if (f.stage === 'extracted_fact' && f.proof_strength >= 0.7) return 'verified_fact';
  if (f.stage === 'verified_fact' && f.usefulness >= 0.7) return 'durable_invariant';
  if (f.stage === 'durable_invariant' && f.recency < 0.5) return 'compact_doctrine';
  return f.stage;
}

function metabolize(facts = []) {
  return facts.map((fact) => {
    const f = normalizeFact(fact);
    const stage = nextStage(f);
    return { ...f, stage, score: metabolismScore(f) };
  });
}

function appendFact(root, fact) {
  const row = { ts: new Date().toISOString(), ...normalizeFact(fact), stage: nextStage(fact), score: metabolismScore(fact) };
  state.append(STORE, row, root);
  return row;
}

function readFacts(root) {
  return state.read(STORE, root);
}

module.exports = { STORE, STAGES, normalizeFact, metabolismScore, nextStage, metabolize, appendFact, readFacts };
