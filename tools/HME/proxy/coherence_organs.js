'use strict';

const state = require('./state_registry');

const PROOF_STORE = 'statefile_proof_capsules';
try { state.register({ name: PROOF_STORE, relPath: 'tools/HME/runtime/proof-capsules.jsonl', format: 'jsonl' }); } catch (_e) {}

const ORGANS = [
  'intent_compiler',
  'proof_capsule_ledger',
  'coherence_field_index',
  'policy_genome',
  'agent_leash_kernel',
  'temporal_freshness_mesh',
];

function _text(value, limit = 500) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function _num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function compileIntent(prompt = '') {
  const text = _text(prompt, 2000).toLowerCase();
  const allSix = /\bdo\s+(?:1\s*-\s*6|1\s*to\s*6)\b/.test(text);
  const scope = allSix ? ORGANS.slice() : [];
  if (/\bhook ui\b|\bsilence\b/.test(text)) scope.push('hook_ui_silence_contract');
  if (/\bschema\b|hookspecificoutput/.test(text)) scope.push('schema_boundary_hardening');
  if (/\bquarantine\b|fingerprint/.test(text)) scope.push('quarantine_convergence_proof');
  return {
    intent: _text(prompt),
    scope: Array.from(new Set(scope)),
    nonGoals: ['no_subagents_without_leash', 'no_manual_restarts', 'no_autocommit_polling', 'no_broad_audits'],
    requiredProof: ['targeted_tests', 'changed_files', 'recurrence_guard'],
    agentPolicy: { allowSubagents: false, requireLeash: true },
  };
}

function normalizeProofCapsule(input = {}) {
  const evidence = Array.isArray(input.evidence) ? input.evidence.map((x) => _text(x, 240)).filter(Boolean) : [];
  const verifiedAt = _text(input.verifiedAt || input.verified_at || input.ts || '');
  const expiresAt = _text(input.expiresAt || input.expires_at || '');
  const confidence = Math.max(0, Math.min(1, _num(input.confidence, evidence.length ? 0.7 : 0.2)));
  return {
    ts: input.ts || new Date().toISOString(),
    claim: _text(input.claim, 500),
    evidence,
    verifier: _text(input.verifier || input.check, 240),
    proof_class: _text(input.proofClass || input.proof_class || 'observed', 80),
    verified_at: verifiedAt,
    expires_at: expiresAt,
    confidence,
    status: evidence.length && confidence >= 0.6 ? 'proved' : 'debt',
  };
}

function appendProofCapsule(root, capsule) {
  const row = normalizeProofCapsule(capsule);
  state.append(PROOF_STORE, row, root);
  return row;
}

function readProofCapsules(root) {
  return state.read(PROOF_STORE, root);
}

function projectCoherenceField(event = {}) {
  const intent = Math.max(0, Math.min(1, _num(event.intent_alignment, event.intent ? 0.7 : 0.3)));
  const proof = Math.max(0, Math.min(1, _num(event.evidence_strength, (event.evidence || []).length ? 0.7 : 0.2)));
  const entropy = Math.max(0, Math.min(1, _num(event.entropy_cost, Math.max(0, _num(event.entropy_delta, 0)))));
  const noise = Math.max(0, Math.min(1, _num(event.noise_risk, 0)));
  const renewal = Math.max(0, Math.min(1, _num(event.recurrence_value, (event.obligations || []).length ? 0.5 : 0.2)));
  const net = Number((intent + proof + renewal - entropy - noise).toFixed(4));
  return { subject: _text(event.subject || event.kind || 'event', 240), intent_alignment: intent, evidence_strength: proof, entropy_cost: entropy, noise_risk: noise, recurrence_value: renewal, net_coherence: net };
}

function summarizeCoherenceField(rows = []) {
  const projected = rows.map(projectCoherenceField);
  const net = projected.reduce((sum, r) => sum + r.net_coherence, 0);
  return { count: projected.length, net_coherence: Number(net.toFixed(4)), high_noise: projected.filter((r) => r.noise_risk >= 0.5).map((r) => r.subject) };
}

function policyGenome(policy = {}) {
  return {
    name: _text(policy.name || 'unknown', 120),
    protects: Array.isArray(policy.protects) ? policy.protects.map((x) => _text(x, 120)).filter(Boolean) : [_text(policy.category || 'unknown', 120)],
    fail_mode: _text(policy.failMode || policy.fail_mode || 'open', 40),
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
  if (!g.fail_mode) missing.push('fail_mode');
  if (!g.owner) missing.push('owner');
  return { ok: missing.length === 0, missing, genome: g };
}

function agentLeashContract(input = {}) {
  const prompt = _text(input.prompt || input.task || '', 3000);
  const scope = _text(input.scope || input.description || '', 240);
  const artifact = _text(input.artifact || input.expected_artifact || '', 240);
  const maxDurationMin = _num(input.maxDurationMin || input.max_duration_min || input.maxMinutes, 0);
  const maxToolCalls = _num(input.maxToolCalls || input.max_tool_calls, 0);
  const promptHasBounds = /max (duration|tool)|artifact|scope:/i.test(prompt);
  const ok = Boolean(scope && artifact && maxDurationMin > 0 && maxToolCalls > 0) || promptHasBounds;
  return { ok, scope, artifact, max_duration_min: maxDurationMin, max_tool_calls: maxToolCalls, reason: ok ? '' : 'Agent launch requires scope, max duration, max tool calls, and expected artifact.' };
}

function freshnessStatus(input = {}) {
  const sourceMtime = _num(input.sourceMtime || input.source_mtime, 0);
  const processStart = _num(input.processStart || input.process_start, 0);
  const runtime = _text(input.runtimeFingerprint || input.runtime_fingerprint || '', 120);
  const wanted = _text(input.wantedFingerprint || input.wanted_fingerprint || runtime, 120);
  const proofTs = _num(input.proofTs || input.proof_ts, 0);
  const runtimeStale = Boolean(wanted && runtime && wanted !== runtime) || (sourceMtime > 0 && processStart > 0 && processStart < sourceMtime);
  const proofStale = proofTs > 0 && sourceMtime > 0 && proofTs < sourceMtime;
  const status = runtimeStale ? 'runtime_stale' : proofStale ? 'proof_stale' : 'fresh';
  return { status, runtime_stale: runtimeStale, proof_stale: proofStale, runtime_fingerprint: runtime, wanted_fingerprint: wanted };
}

module.exports = {
  ORGANS,
  compileIntent,
  normalizeProofCapsule,
  appendProofCapsule,
  readProofCapsules,
  projectCoherenceField,
  summarizeCoherenceField,
  policyGenome,
  validatePolicyGenome,
  agentLeashContract,
  freshnessStatus,
};
