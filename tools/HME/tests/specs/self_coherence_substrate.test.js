'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const claims = require('../../proxy/coherence_claims');
const quality = require('../../proxy/tool_response_quality');
const { evaluateForkProof } = require('../../proxy/agent_fork_proof');
const kb = require('../../proxy/kb_semantic_checksum');
const graph = require('../../proxy/claim_graph');
const { evaluateClaims } = require('../../proxy/coherence_gate');
const { splitScores } = require('../../proxy/hci_split');
const { splitVerdict } = require('../../proxy/pipeline_verdict_split');

function sampleClaim(overrides = {}) {
  const evidence_hash = claims.evidenceHash({ fail: 0 });
  return {
    schema_version: claims.CLAIM_SCHEMA_VERSION,
    claim_id: 'comment-bloat.fail-count.zero',
    subject_uri: 'repo://tools/HME/scripts/audit-comment-bloat.py',
    producer: 'audit-comment-bloat.py',
    producer_version: 'git:test',
    status: 'pass',
    severity: 'info',
    confidence: 1,
    evidence_uri: 'repo://runtime/hme-claims/comment-bloat.json',
    evidence_hash,
    scope: ['repo://src', 'repo://tools/HME'],
    invalidator_keys: ['tracked_code_edit', 'verifier_edit'],
    generated_at: '2026-06-13T00:00:00Z',
    expires_at: null,
    freshness_proof: { kind: 'audit_run', generated_at: '2026-06-13T00:00:00Z', evidence_hash },
    repair: 'manual condensation',
    tests: ['comment_bloat_audit.test.js'],
    retirement_condition: 'policy retired',
    supersedes: [],
    ...overrides,
  };
}

test('coherence claim validates, invalidates, and round-trips', () => {
  const claim = sampleClaim();
  assert.equal(claims.validateClaim(claim).ok, true);
  assert.equal(claims.isCurrent(claim, []).current, true);
  assert.equal(claims.isCurrent(claim, [{ key: 'tracked_code_edit', subject_uri: 'repo://src/a.js', ts: '2026-06-13T00:01:00Z' }]).current, false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-claims-'));
  try {
    const fp = claims.writeClaim(claim, { dir });
    assert.equal(claims.readClaim(fp).claim_id, claim.claim_id);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tool response quality logs contract violations and low ratings only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-tool-quality-'));
  const file = path.join(dir, 'ledger.jsonl');
  try {
    assert.equal(quality.record({ tool: 'i/status', rating: 8 }, { file, threshold: 7 }).logged, false);
    assert.equal(quality.record({ tool: 'i/status', rating: 5, defect: 'stale', owner: 'state-panel' }, { file, threshold: 7 }).logged, true);
    assert.equal(quality.record({ tool: 'i/status', rating: 10, contract_violation: true, defect: 'false success' }, { file, threshold: 7 }).logged, true);
    assert.equal(fs.readFileSync(file, 'utf8').trim().split('\n').length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('agent fork proof fails closed on missing telemetry and rejects fresh context', () => {
  assert.equal(evaluateForkProof(null).ok, false);
  assert.equal(evaluateForkProof({ source_session_tokens: 100, agent_context_tokens: 10 }).action, 'reroute');
  assert.equal(evaluateForkProof({ source_session_tokens: 100, agent_context_tokens: 90, raw_context_fresh: true }).reason, 'fresh_context_not_fork');
  assert.equal(evaluateForkProof({ source_session_tokens: 100, agent_context_tokens: 90 }).ok, true);
});

test('KB semantic checksum marks referenced file or symbol edits stale', () => {
  const entry = { source_files: ['src/a.js'], symbols: ['foo'], tests: ['a.test.js'], supersession_condition: 'foo removed' };
  assert.match(kb.checksumEntry(entry), /^sha256:/);
  assert.equal(kb.isPossiblyStale(entry, [{ path: 'src/a.js' }]).stale, true);
  assert.equal(kb.isPossiblyStale(entry, [{ symbol: 'foo' }]).stale, true);
  assert.equal(kb.isPossiblyStale(entry, [{ path: 'src/b.js' }]).stale, false);
});

test('coherence gate rejects stale-current claims', () => {
  const claim = sampleClaim();
  const result = evaluateClaims([claim], [{ key: 'tracked_code_edit', subject_uri: 'repo://src/a.js', ts: '2026-06-13T00:01:00Z' }]);
  assert.equal(result.ok, false);
  assert.equal(result.failures[0].reason, 'stale_claim_presented_current');
});

test('HCI split weights maintenance differently from composition', () => {
  const maintenance = splitScores({ phase: 'maintenance', verifier: 1, behavior: 0.2, tooling: 1, temporal: 1 });
  const composition = splitScores({ phase: 'composition', verifier: 1, behavior: 0.2, tooling: 1, temporal: 1 });
  assert.ok(maintenance.composite > composition.composite);
  assert.equal(maintenance.phase, 'maintenance');
});

test('pipeline verdict split exposes diagnostic failures hidden by STABLE', () => {
  const verdict = splitVerdict({ verdict: 'STABLE', errorPatterns: [{ label: 'diagnostic', errors: ['boom'] }] });
  assert.equal(verdict.behavioral_verdict, 'STABLE');
  assert.equal(verdict.diagnostic_verdict, 'FAIL');
  assert.match(verdict.exit_policy, /fail unless/);
});

test('claim graph links file, verifier, test, and repair evidence', () => {
  const g = graph.createGraph();
  graph.addNode(g, 'file:comment-bloat', 'file');
  graph.addNode(g, 'verifier:comment-bloat', 'verifier');
  graph.addNode(g, 'test:comment-bloat', 'test');
  graph.addEdge(g, 'file:comment-bloat', 'measured_by', 'verifier:comment-bloat');
  graph.addEdge(g, 'test:comment-bloat', 'preserves', 'verifier:comment-bloat');
  const explanation = graph.explain(g, 'verifier:comment-bloat');
  assert.equal(explanation.incoming.length, 2);
});
