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
    evidence_hash: claims.evidenceHash({ fail: 0 }),
    scope: ['repo://src', 'repo://tools/HME'],
    invalidator_keys: ['tracked_code_edit', 'verifier_edit'],
    generated_at: '2026-06-13T00:00:00Z',
    expires_at: null,
    repair: 'manual condensation',
    regression_tests: ['comment_bloat_audit.test.js'],
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
