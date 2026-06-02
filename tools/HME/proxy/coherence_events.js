'use strict';

const state = require('./state_registry');

const LEDGER_STORE = 'statefile_coherence_events';
const KINDS = new Set(['tool_use', 'edit', 'test', 'claim', 'failure', 'memory', 'policy_decision', 'incident', 'resolver', 'invariant', 'budget']);
const PROOF_CLASSES = new Set(['observed', 'executed', 'derived', 'hypothesis', 'policy', 'stale', 'unknown']);

function _single(value, limit = 500) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function _num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeEvent(input = {}) {
  if (!input || typeof input !== 'object') throw new Error('coherence event object required');
  const kind = _single(input.kind || 'policy_decision', 80);
  if (!KINDS.has(kind)) throw new Error(`unsupported coherence event kind: ${kind}`);
  const proofClass = _single(input.proofClass || input.proof_class || 'unknown', 40);
  return {
    ts: input.ts || new Date().toISOString(),
    kind,
    subject: _single(input.subject || '', 240),
    intent: _single(input.intent || '', 500),
    evidence: Array.isArray(input.evidence) ? input.evidence.map((x) => _single(x, 240)).filter(Boolean).slice(0, 20) : [],
    coherence_delta: _num(input.coherence_delta, 0),
    entropy_delta: _num(input.entropy_delta, 0),
    obligations: Array.isArray(input.obligations) ? input.obligations.map((x) => _single(x, 240)).filter(Boolean).slice(0, 20) : [],
    expires: _single(input.expires || '', 160),
    proof_class: PROOF_CLASSES.has(proofClass) ? proofClass : 'unknown',
    meta: input.meta && typeof input.meta === 'object' ? { ...input.meta } : {},
  };
}

function appendEvent(root, input) {
  const event = normalizeEvent(input);
  state.append(LEDGER_STORE, event, root);
  return event;
}

function readEvents(root, opts = {}) {
  const rows = state.read(LEDGER_STORE, root);
  const limit = Number(opts.limit || 0);
  return limit > 0 ? rows.slice(-limit) : rows;
}

function summarize(events = []) {
  const out = { total: 0, open_obligations: [], by_kind: {}, coherence_delta: 0, entropy_delta: 0 };
  for (const ev of events) {
    out.total += 1;
    out.by_kind[ev.kind] = (out.by_kind[ev.kind] || 0) + 1;
    out.coherence_delta += _num(ev.coherence_delta, 0);
    out.entropy_delta += _num(ev.entropy_delta, 0);
    for (const ob of ev.obligations || []) if (!out.open_obligations.includes(ob)) out.open_obligations.push(ob);
  }
  out.open_obligations = out.open_obligations.slice(0, 50);
  return out;
}

module.exports = { LEDGER_STORE, KINDS, PROOF_CLASSES, normalizeEvent, appendEvent, readEvents, summarize };
