'use strict';

const state = require('./state_registry');

const PROOF_STORE = 'statefile_proof_capsules';
try { state.register({ name: PROOF_STORE, relPath: 'tools/HME/runtime/proof-capsules.jsonl', format: 'jsonl' }); } catch (_e) {}

const COHERENCE_ORGANS = [
  'coherence_field',
  'proof_capsules',
  'causal_braid',
  'coherence_immune_system',
  'policy_genome',
  'temporal_coherence',
];

const VECTOR_FIELDS = [
  'intent_alignment',
  'evidence_strength',
  'entropy_cost',
  'causal_parent',
  'invariant_touched',
  'user_pain_addressed',
  'reversibility',
  'freshness',
  'proof_status',
  'noise_risk',
];

function _text(value, limit = 500) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function _num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function _unit(value, fallback = 0) {
  return Math.max(0, Math.min(1, _num(value, fallback)));
}

function normalizeCoherenceVector(input = {}) {
  const evidenceDefault = Array.isArray(input.evidence) && input.evidence.length ? 0.7 : 0.2;
  return {
    intent_alignment: _unit(input.intent_alignment, input.intent ? 0.7 : 0.3),
    evidence_strength: _unit(input.evidence_strength, evidenceDefault),
    entropy_cost: _unit(input.entropy_cost, Math.max(0, _num(input.entropy_delta, 0))),
    causal_parent: _text(input.causal_parent || input.parent || '', 240),
    invariant_touched: _text(input.invariant_touched || input.invariant || '', 240),
    user_pain_addressed: _unit(input.user_pain_addressed, input.user_pain ? 0.7 : 0),
    reversibility: _unit(input.reversibility, 0.5),
    freshness: _unit(input.freshness, input.proof_status === 'stale' ? 0.2 : 0.7),
    proof_status: _text(input.proof_status || input.proof_class || 'unknown', 80),
    noise_risk: _unit(input.noise_risk, 0),
  };
}

function coherenceEffect(vector) {
  const v = normalizeCoherenceVector(vector);
  if (v.noise_risk >= 0.7 || v.entropy_cost >= 0.8) return 'parasitize';
  if (v.evidence_strength < 0.3 && v.intent_alignment < 0.5) return 'obscure';
  if (v.user_pain_addressed >= 0.6 && v.evidence_strength >= 0.6) return 'repair';
  if (v.reversibility < 0.3 && v.intent_alignment >= 0.6) return 'mutate';
  if (v.intent_alignment >= 0.7 && v.evidence_strength >= 0.6) return 'clarify';
  return 'preserve';
}

function projectCoherenceField(event = {}) {
  const vector = normalizeCoherenceVector(event);
  const net = Number((vector.intent_alignment + vector.evidence_strength + vector.user_pain_addressed + vector.reversibility + vector.freshness - vector.entropy_cost - vector.noise_risk).toFixed(4));
  return { subject: _text(event.subject || event.kind || 'event', 240), ...vector, net_coherence: net, effect: coherenceEffect(vector) };
}

function summarizeCoherenceField(rows = []) {
  const projected = rows.map(projectCoherenceField);
  const net = projected.reduce((sum, r) => sum + r.net_coherence, 0);
  return { count: projected.length, net_coherence: Number(net.toFixed(4)), effects: projected.reduce((acc, row) => ({ ...acc, [row.effect]: (acc[row.effect] || 0) + 1 }), {}), high_noise: projected.filter((r) => r.noise_risk >= 0.5).map((r) => r.subject) };
}

function normalizeProofCapsule(input = {}) {
  const evidence = Array.isArray(input.evidence) ? input.evidence.map((x) => _text(x, 240)).filter(Boolean) : [];
  const artifacts = Array.isArray(input.artifacts) ? input.artifacts.map((x) => _text(x, 300)).filter(Boolean).slice(0, 50) : [];
  const verifiedAt = _text(input.verifiedAt || input.verified_at || input.ts || '');
  const expiresAt = _text(input.expiresAt || input.expires_at || '');
  const freshness = _unit(input.freshness, expiresAt ? 0.8 : 0.6);
  const confidence = _unit(input.confidence, evidence.length ? 0.7 : 0.2);
  const decay = _unit(input.decay, 1 - freshness);
  return {
    ts: input.ts || new Date().toISOString(),
    claim: _text(input.claim, 500),
    evidence,
    artifacts,
    verifier: _text(input.verifier || input.check, 240),
    freshness,
    confidence,
    decay,
    proof_status: evidence.length && confidence >= 0.6 && freshness >= 0.4 ? 'proved' : 'debt',
    verified_at: verifiedAt,
    expires_at: expiresAt,
  };
}

function appendProofCapsule(root, capsule) {
  const row = normalizeProofCapsule(capsule);
  state.append(PROOF_STORE, row, root);
  return row;
}

const PROOF_TTL_MS = 24 * 60 * 60 * 1000;

// Proof decays with age: a capsule verified two days ago no longer backs a
// "fixed" claim. Recompute freshness from elapsed time (or explicit expires_at)
function decayProofCapsule(capsule, now = Date.now()) {
  const c = normalizeProofCapsule(capsule);
  const base = Date.parse(c.verified_at || c.ts || '') || 0;
  const expiry = Date.parse(c.expires_at || '') || (base ? base + PROOF_TTL_MS : 0);
  let freshness = c.freshness;
  if (expiry) {
    const remaining = expiry - now;
    const span = expiry - (base || (expiry - PROOF_TTL_MS));
    freshness = span > 0 ? _unit(remaining / span, 0) : 0;
  }
  const expired = expiry > 0 && now >= expiry;
  return { ...c, freshness, decay: _unit(1 - freshness), expired, proof_status: (!expired && c.evidence.length && c.confidence >= 0.6 && freshness >= 0.4) ? 'proved' : 'debt' };
}

function readProofCapsules(root, opts = {}) {
  const rows = state.read(PROOF_STORE, root);
  if (!opts.decay && !opts.freshOnly) return rows;
  const now = Number(opts.now || Date.now());
  const decayed = rows.map((r) => decayProofCapsule(r, now));
  return opts.freshOnly ? decayed.filter((c) => !c.expired && c.proof_status === 'proved') : decayed;
}

// Fresh, still-proved capsules a completion claim may rely on right now.
function freshProofCapsules(root, now = Date.now()) {
  return readProofCapsules(root, { freshOnly: true, now });
}

// Does any fresh proved capsule back a claim about these artifacts? Same-artifact
// match when files are known (blocks cross-turn proof laundering); when files are
function capsuleBacksArtifacts(capsules, files) {
  const fresh = (capsules || []).filter((c) => c && c.proof_status === 'proved' && !c.expired);
  if (!fresh.length) return false;
  const wanted = (files || []).map((f) => _text(f, 300)).filter(Boolean);
  if (!wanted.length) return true;
  return fresh.some((c) => Array.isArray(c.artifacts) && c.artifacts.some((a) => wanted.includes(a)));
}

function causalBraid(input = {}) {
  const steps = [
    ['user_pain', input.user_pain],
    ['violated_invariant', input.violated_invariant],
    ['responsible_subsystem', input.responsible_subsystem || input.subsystem],
    ['runtime_state', input.runtime_state],
    ['code_cause', input.code_cause],
    ['verification', input.verification],
    ['recurrence_guard', input.recurrence_guard],
    ['memory_crystallization', input.memory_crystallization || input.memory],
  ].map(([kind, value]) => ({ kind, value: _text(value, 500), proved: Boolean(_text(value, 500)) }));
  return { id: _text(input.id || input.subject || 'causal-braid', 160), chain: steps, missing: steps.filter((s) => !s.proved).map((s) => s.kind) };
}

const IMMUNE_PATTERNS = [
  ['repeated_hook_ui', /repeated hook|hook ui|additionalContext.*spam|crying_wolf/i, 'suppress'],
  ['subagent_overrun', /subagent.*(overrun|late|20 minutes|runaway)/i, 'quarantine'],
  ['manual_auto_poll', /manual.*(autocommit|automatic|auto system)|autocommit.*poll/i, 'repair'],
  ['stale_runtime', /stale daemon|module cache|runtime stale|old code/i, 'repair'],
  ['schema_drift', /hookSpecificOutput|hookEventName|schema drift/i, 'repair'],
  ['context_burn', /context burn|useless explanation|wall of text|acknowledge/i, 'suppress'],
  ['ceremonial_verification', /ceremony|manual check|redundant test/i, 'metabolize'],
];

function immuneResponse(input = {}) {
  const text = _text(input.text || input.message || input.summary || '', 2000);
  const hits = IMMUNE_PATTERNS.filter(([, re]) => re.test(text)).map(([kind, , action]) => ({ kind, action }));
  return { signal: text, hits, classification: hits[0] ? hits[0].kind : 'none', action: hits[0] ? hits[0].action : 'observe', memory: hits.length ? 'record_pattern' : 'none' };
}

function policyGenome(policy = {}) {
  return {
    name: _text(policy.name || 'unknown', 120),
    protects: Array.isArray(policy.protects) ? policy.protects.map((x) => _text(x, 120)).filter(Boolean) : [_text(policy.category || 'unknown', 120)],
    known_false_positives: Array.isArray(policy.known_false_positives) ? policy.known_false_positives.map((x) => _text(x, 160)).filter(Boolean) : [],
    fail_open_or_closed: _text(policy.failOpenOrClosed || policy.fail_open_or_closed || policy.failMode || 'open', 40),
    visible_output_allowed: Boolean(policy.visibleOutputAllowed || policy.visible_output_allowed || false),
    telemetry_only: policy.telemetryOnly !== false,
    owner: _text(policy.owner || 'HME', 120),
    recurrence_test: _text(policy.recurrenceTest || policy.recurrence_test || '', 240),
    retirement_condition: _text(policy.retirementCondition || policy.retirement_condition || '', 240),
  };
}

function validatePolicyGenome(policy = {}) {
  const g = policyGenome(policy);
  const missing = [];
  if (!g.protects.length || !g.protects[0]) missing.push('protects');
  if (!g.fail_open_or_closed) missing.push('fail_open_or_closed');
  if (!g.owner) missing.push('owner');
  return { ok: missing.length === 0, missing, genome: g };
}

function freshnessStatus(input = {}) {
  const sourceMtime = _num(input.sourceMtime || input.source_mtime, 0);
  const processStart = _num(input.processStart || input.process_start, 0);
  const moduleImport = _num(input.moduleImportTime || input.module_import_time, processStart);
  const runtime = _text(input.runtimeFingerprint || input.runtime_fingerprint || '', 120);
  const wanted = _text(input.wantedFingerprint || input.wanted_fingerprint || runtime, 120);
  const proofTs = _num(input.proofTs || input.proof_ts, 0);
  const runtimeStale = Boolean(wanted && runtime && wanted !== runtime) || (sourceMtime > 0 && processStart > 0 && processStart < sourceMtime) || (sourceMtime > 0 && moduleImport > 0 && moduleImport < sourceMtime);
  const proofStale = proofTs > 0 && sourceMtime > 0 && proofTs < sourceMtime;
  const status = runtimeStale ? 'runtime_stale' : proofStale ? 'proof_stale' : 'fresh';
  return { status, source_mtime: sourceMtime, process_start_time: processStart, module_import_time: moduleImport, runtime_stale: runtimeStale, proof_stale: proofStale, runtime_fingerprint: runtime, wanted_fingerprint: wanted };
}

module.exports = {
  COHERENCE_ORGANS,
  VECTOR_FIELDS,
  normalizeCoherenceVector,
  coherenceEffect,
  projectCoherenceField,
  summarizeCoherenceField,
  normalizeProofCapsule,
  appendProofCapsule,
  readProofCapsules,
  decayProofCapsule,
  freshProofCapsules,
  PROOF_TTL_MS,
  causalBraid,
  immuneResponse,
  policyGenome,
  validatePolicyGenome,
  freshnessStatus,
};
