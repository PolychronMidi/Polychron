'use strict';

const PHASES = new Set(['maintenance', 'composition', 'audit', 'exploration', 'repair']);

function normalizePhase(phase) {
  return PHASES.has(phase) ? phase : 'maintenance';
}

function _clamp(n) {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
}

function toolingScoreFromLedger(ledger = {}, opts = {}) {
  const total = Number(ledger.total_defects || 0);
  const contract = Number(ledger.contract_violations || 0);
  const invalid = Number(ledger.invalid_rows || 0);
  const defectWeight = Number.isFinite(opts.defectWeight) ? opts.defectWeight : 0.08;
  const contractWeight = Number.isFinite(opts.contractWeight) ? opts.contractWeight : 0.20;
  const invalidWeight = Number.isFinite(opts.invalidWeight) ? opts.invalidWeight : 0.05;
  return _clamp(1 - total * defectWeight - contract * contractWeight - invalid * invalidWeight);
}

function splitScores(input = {}) {
  const phase = normalizePhase(input.phase);
  const verifier = Number.isFinite(input.verifier) ? input.verifier : 1;
  const behavior = Number.isFinite(input.behavior) ? input.behavior : verifier;
  const tooling = Number.isFinite(input.tooling) ? input.tooling : (input.tooling_ledger ? toolingScoreFromLedger(input.tooling_ledger) : verifier);
  const temporal = Number.isFinite(input.temporal) ? input.temporal : verifier;
  const weights = phase === 'composition'
    ? { verifier: 0.30, behavior: 0.35, tooling: 0.20, temporal: 0.15 }
    : phase === 'maintenance'
      ? { verifier: 0.45, behavior: 0.15, tooling: 0.20, temporal: 0.20 }
      : { verifier: 0.35, behavior: 0.25, tooling: 0.20, temporal: 0.20 };
  const composite = verifier * weights.verifier + behavior * weights.behavior + tooling * weights.tooling + temporal * weights.temporal;
  return { phase, verifier, behavior, tooling, temporal, composite, weights };
}

function claimForSplit(scores, fields = {}) {
  const evidence_hash = fields.evidence_hash || 'sha256:' + '0'.repeat(64);
  return {
    schema_version: '1.0.0',
    claim_id: fields.claim_id || 'hci.split.current',
    subject_uri: fields.subject_uri || 'repo://tools/HME/scripts/verify-coherence.py',
    producer: fields.producer || 'hci_split.js',
    producer_version: fields.producer_version || 'git:unknown',
    status: scores.composite >= 0.8 ? 'pass' : 'warn',
    severity: scores.composite >= 0.8 ? 'info' : 'warn',
    confidence: 0.8,
    evidence_uri: fields.evidence_uri || 'repo://src/output/metrics/pipeline-summary.json',
    evidence_hash,
    scope: fields.scope || ['repo://tools/HME/scripts', 'repo://src/output/metrics'],
    invalidator_keys: ['verifier_edit', 'pipeline_run', 'tool_response_defect'],
    generated_at: fields.generated_at || new Date().toISOString(),
    expires_at: fields.expires_at || null,
    freshness_proof: { kind: 'hci_split', generated_at: fields.generated_at || new Date().toISOString(), evidence_hash },
    repair: fields.repair || 'inspect failing HCI component instead of trusting composite alone',
    tests: fields.tests || ['self_coherence_substrate.test.js'],
    retirement_condition: fields.retirement_condition || 'HCI split superseded by richer component model',
    supersedes: fields.supersedes || [],
  };
}

module.exports = { PHASES, normalizePhase, toolingScoreFromLedger, splitScores, claimForSplit };
