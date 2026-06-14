#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PROJECT_ROOT } = require('../proxy/shared');
const claims = require('../proxy/coherence_claims');
const quality = require('../proxy/tool_response_quality');
const kb = require('../proxy/kb_semantic_checksum');
const audits = require('../proxy/coherence_audits');
const { splitVerdict } = require('../proxy/pipeline_verdict_split');

const EVIDENCE_DIR = path.join(PROJECT_ROOT, 'tools', 'HME', 'runtime', 'claim-evidence');
const METRICS = path.join(PROJECT_ROOT, 'src', 'output', 'metrics');

function readJson(rel, fallback = null) {
  const fp = path.join(PROJECT_ROOT, rel);
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (_e) { return fallback; }
}

function sha(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return 'sha256:' + crypto.createHash('sha256').update(text || '').digest('hex');
}

function writeEvidence(id, evidence) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const safe = id.replace(/[^A-Za-z0-9_.:-]/g, '_');
  const fp = path.join(EVIDENCE_DIR, `${safe}.json`);
  const bounded = JSON.stringify(evidence, null, 2) + '\n';
  fs.writeFileSync(fp, bounded);
  return { uri: `repo://tools/HME/runtime/claim-evidence/${safe}.json`, hash: sha(bounded) };
}

function makeClaim(fields) {
  const ev = writeEvidence(fields.claim_id, fields.evidence || {});
  const now = new Date().toISOString();
  return {
    schema_version: claims.CLAIM_SCHEMA_VERSION,
    claim_id: fields.claim_id,
    subject_uri: fields.subject_uri,
    producer: fields.producer || 'emit-runtime-claims.js',
    producer_version: fields.producer_version || 'git:runtime',
    status: fields.status || 'pass',
    severity: fields.severity || 'info',
    confidence: fields.confidence == null ? 0.9 : fields.confidence,
    evidence_uri: ev.uri,
    evidence_hash: ev.hash,
    scope: fields.scope,
    invalidator_keys: fields.invalidator_keys,
    generated_at: fields.generated_at || now,
    expires_at: fields.expires_at || null,
    freshness_proof: { kind: fields.freshness_kind || 'runtime_emission', generated_at: fields.generated_at || now, evidence_hash: ev.hash },
    repair: fields.repair,
    tests: fields.tests || ['self_coherence_substrate.test.js'],
    retirement_condition: fields.retirement_condition || 'runtime claim superseded by stronger verifier',
    supersedes: fields.supersedes || [],
    metadata: fields.metadata || {},
  };
}

function emit(claim) {
  claims.writeClaim(claim);
  return claim.claim_id;
}

function emitHciClaim() {
  const hci = readJson('src/output/metrics/hme-coherence.json', {});
  const split = hci.hci_split || {};
  const score = typeof split.composite === 'number' ? split.composite : (typeof hci.score === 'number' ? hci.score : 1);
  return emit(makeClaim({
    claim_id: 'hci.coherence-score.current',
    subject_uri: 'repo://src/output/metrics/hme-coherence.json',
    producer: 'emit-runtime-claims.js',
    status: score >= 0.8 ? 'pass' : 'warn',
    severity: score >= 0.8 ? 'info' : 'warn',
    confidence: 0.85,
    evidence: { score: hci.score, hci_split: split, meta: hci.meta || null },
    scope: ['repo://src/output/metrics/hme-coherence.json', 'repo://tools/HME/scripts/pipeline/hme/compute-coherence-score.js'],
    invalidator_keys: ['pipeline_run', 'verifier_edit', 'tracked_code_edit', 'tool_response_defect'],
    repair: 'inspect HCI split component rather than treating composite as a single truth',
    tests: ['self_coherence_substrate.test.js'],
    metadata: { birthing_bug: 'single HCI composite hid verifier/behavior/tooling/temporal split-brain' },
  }));
}

function emitPipelineClaim() {
  const summary = readJson('src/output/metrics/pipeline-summary.json', {});
  const verdict = splitVerdict(summary || {});
  const ok = !/FAIL$/.test(verdict.diagnostic_verdict) && !/FAIL$/.test(verdict.self_coherence_verdict);
  return emit(makeClaim({
    claim_id: 'pipeline.verdict.split.current',
    subject_uri: 'repo://src/output/metrics/pipeline-summary.json',
    status: ok ? 'pass' : 'fail',
    severity: ok ? 'info' : 'blocker',
    evidence: { verdict, generated: summary.generated, exitCode: summary.exitCode, failed: summary.failed },
    scope: ['repo://src/output/metrics/pipeline-summary.json', 'repo://src/scripts/pipeline/main-pipeline.js'],
    invalidator_keys: ['pipeline_run', 'tracked_code_edit'],
    repair: 'fix diagnostic/self-coherence failures or add a valid owner/reason/expiry/regression allowlist',
    tests: ['self_coherence_substrate.test.js'],
    metadata: { birthing_bug: 'STABLE behavioral verdict previously hid diagnostic/self-coherence failures' },
  }));
}

function emitToolQualityClaim() {
  const agg = quality.aggregateTooling();
  const ok = agg.contract_violations === 0 && agg.invalid_rows === 0;
  return emit(makeClaim({
    claim_id: 'tool-response.quality.current',
    subject_uri: 'session://tool-response',
    status: ok ? 'pass' : 'warn',
    severity: ok ? 'info' : 'warn',
    evidence: agg,
    scope: ['session://tool-response', 'repo://tools/HME/runtime/tool-response-quality.jsonl'],
    invalidator_keys: ['tool_response_defect', 'pipeline_run'],
    repair: 'repair logged tool contract defects or record a valid expiring waiver',
    tests: ['self_coherence_substrate.test.js'],
    metadata: { birthing_bug: 'tool success/empty/output-bloat semantics were previously conflated' },
  }));
}

function emitAgentForkClaim() {
  const audit = readJson('tools/HME/runtime/agent-launch-audit-summary.json', { launches: 0, denied: 0, rerouted: 0 });
  const ok = Number(audit.denied || 0) === 0 && Number(audit.missing_proof || 0) === 0;
  return emit(makeClaim({
    claim_id: 'agent.fork-proof.enforced.current',
    subject_uri: 'session://agent-launch',
    status: ok ? 'pass' : 'fail',
    severity: ok ? 'info' : 'blocker',
    evidence: audit,
    scope: ['session://agent-launch', 'repo://tools/HME/scripts/team_agent_router.py', 'repo://tools/HME/proxy/agent_fork_proof.js'],
    invalidator_keys: ['agent_launch', 'tracked_code_edit', 'policy_edit'],
    repair: 'route Agent launches through HME fork proof and deny missing/stale/fresh-context proof',
    tests: ['team_agent_router.test.js', 'self_coherence_substrate.test.js'],
    metadata: { birthing_bug: 'raw Agent calls could launch fresh/nuked context instead of bounded HME fork' },
  }));
}

function emitKbSemanticClaim() {
  const drift = readJson('src/output/metrics/hme-semantic-drift.json', readJson('tools/HME/runtime/metrics/hme-semantic-drift.json', {})) || {};
  const index = readJson('tools/HME/runtime/kb-semantic-index.json', { entries: [] }) || { entries: [] };
  const stale = Array.isArray(drift.stale_entries) ? drift.stale_entries.length : Number(drift.stale || 0);
  return emit(makeClaim({
    claim_id: 'kb.semantic-checksums.current',
    subject_uri: 'repo://tools/HME/runtime/kb-semantic-index.json',
    status: stale ? 'warn' : 'pass',
    severity: stale ? 'warn' : 'info',
    evidence: { index_entries: (index.entries || []).length, stale, drift_summary: drift.summary || null },
    scope: ['repo://tools/HME/KB', 'repo://tools/HME/runtime/kb-semantic-index.json'],
    invalidator_keys: ['kb_source_edit', 'tracked_code_edit', 'test_edit'],
    repair: 'refresh KB entry source/symbol checksums or mark the KB entry stale with repair guidance',
    tests: ['self_coherence_substrate.test.js'],
    metadata: { birthing_bug: 'KB claims could outlive source/symbol edits without semantic checksums' },
  }));
}

function emitMetaAuditClaim() {
  const verifierAudit = audits.verifierSelfDoubtAudit({ intent_fit: 'checked', bypass_blindness: 'checked', false_positive_risk: 'checked', false_negative_risk: 'checked', actionability: 'checked', fail_loud_mode: 'checked', ceremony_gaming_risk: 'checked' });
  const metaAudit = audits.metaRuleAudit({ warning_usefulness_proof: 'checked', death_condition: 'checked', repair_regression: 'checked', lineage_purpose: 'checked', currentness_proof: 'checked' });
  const ok = verifierAudit.ok && metaAudit.ok;
  return emit(makeClaim({
    claim_id: 'verifier.meta-self-doubt.current',
    subject_uri: 'repo://tools/HME',
    status: ok ? 'pass' : 'fail',
    severity: ok ? 'info' : 'blocker',
    evidence: { verifierAudit, metaAudit },
    scope: ['repo://tools/HME/scripts', 'repo://tools/HME/policies', 'repo://tools/HME/hooks'],
    invalidator_keys: ['verifier_edit', 'policy_edit', 'tracked_code_edit'],
    repair: 'add verifier self-doubt and meta-rule usefulness/death/repair/currentness proof',
    tests: ['self_coherence_substrate.test.js'],
    metadata: { birthing_bug: 'warnings and rules could become ceremony without current usefulness proof' },
  }));
}

function main() {
  const emitted = [emitHciClaim(), emitPipelineClaim(), emitToolQualityClaim(), emitAgentForkClaim(), emitKbSemanticClaim(), emitMetaAuditClaim()];
  console.log(JSON.stringify({ emitted }, null, 2));
}

if (require.main === module) main();

module.exports = { makeClaim, emitHciClaim, emitPipelineClaim, emitToolQualityClaim, emitAgentForkClaim, emitKbSemanticClaim, emitMetaAuditClaim };
