'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const claims = require('../../proxy/coherence_claims');
const quality = require('../../proxy/tool_response_quality');
const { TELEMETRY_SOURCE, evaluateForkProof, evaluateAgentLaunch } = require('../../proxy/agent_fork_proof');
const kb = require('../../proxy/kb_semantic_checksum');
const graph = require('../../proxy/claim_graph');
const audits = require('../../proxy/coherence_audits');
const { evaluateClaims } = require('../../proxy/coherence_gate');
const { splitScores, toolingScoreFromLedger } = require('../../proxy/hci_split');
const { splitVerdict, activeAllowlist } = require('../../proxy/pipeline_verdict_split');

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

test('claim schema rejects missing freshness, secrets, superseded, and unknown relevant invalidators', () => {
  assert.equal(claims.validateClaim(sampleClaim({ freshness_proof: undefined })).ok, false);
  assert.equal(claims.validateClaim(sampleClaim({ metadata: { raw_prompt: 'do not store raw prompt' } })).ok, false);
  assert.equal(claims.isCurrent(sampleClaim({ superseded_by: 'new.claim' }), []).reason, 'superseded');
  const unknown = claims.isCurrent(sampleClaim(), [{ key: 'new_relevant_thing', subject_uri: 'repo://src/a.js', ts: '2026-06-13T00:01:00Z' }]);
  assert.equal(unknown.reason, 'unknown_relevant_invalidator');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-claim-state-'));
  try {
    const invalidPath = path.join(dir, 'bad.json');
    fs.writeFileSync(invalidPath, JSON.stringify({ nope: true }));
    assert.equal(claims.readClaimState(invalidPath).state, 'invalid');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('tool response ledger validates taxonomy, waivers, and HCI tooling aggregation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-tool-quality-'));
  const file = path.join(dir, 'ledger.jsonl');
  try {
    assert.throws(() => quality.record({ tool: 'i/status', rating: 5 }, { file, strict: true }), /missing owner/);
    const row = { tool: 'i/status', rating: 5, defect_class: 'stale_state', defect: 'stale panel', owner: 'state-panel', reproduction: 'run i/status', regression: 'state_panel.test.js' };
    quality.record(row, { file, strict: true });
    const waive = quality.recordWaiver({ ...row, waiver_reason: 'known flake', waiver_expires_at: '2099-01-01T00:00:00Z', evidence: { uri: 'repo://log/waiver' } }, { file: path.join(dir, 'waivers.jsonl') });
    assert.equal(quality.isWaiverActive(waive.entry), true);
    const agg = quality.aggregateTooling(file);
    assert.equal(agg.total_defects, 1);
    assert.ok(toolingScoreFromLedger(agg) < 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('agent fork proof carries canonical telemetry, bounded prompts, and emergency allowlist', () => {
  assert.equal(TELEMETRY_SOURCE.name, 'omniroute_token_telemetry');
  const launch = evaluateAgentLaunch({
    proof: { source_session_tokens: 100, agent_context_tokens: 90, telemetry_generated_at: new Date().toISOString(), route_id: 'r' },
    prompt_metadata: { max_files: 8, max_words: 900, no_subagents: true, no_multi_tool_agent: true, default_fork: true },
  });
  assert.equal(launch.ok, true);
  assert.equal(evaluateAgentLaunch({ proof: { source_session_tokens: 100, agent_context_tokens: 90, telemetry_generated_at: new Date().toISOString() }, prompt_metadata: { max_files: 30 } }).ok, false);
  assert.equal(evaluateAgentLaunch({ emergency_allowlist: { owner: 'human', reason: 'outage', expires_at: '2099-01-01T00:00:00Z', audit_trail: ['ticket'] } }).reason, 'emergency_allowlist');
});

test('KB semantic checksum validates required metadata and checksum drift', () => {
  const entry = { source_files: ['src/a.js'], symbols: ['foo'], tests: ['a.test.js'], decision_date: '2026-06-13T00:00:00Z', confidence: 0.9, evidence_hash: claims.evidenceHash('kb'), supersession_condition: 'foo removed', source_checksums: { 'src/a.js': claims.evidenceHash('old') }, symbol_checksums: { foo: claims.evidenceHash('old-symbol') } };
  assert.equal(kb.validateEntry(entry).ok, true);
  assert.equal(kb.validateEntry({}).ok, false);
  assert.equal(kb.isPossiblyStale(entry, [{ path: 'src/a.js', checksum: claims.evidenceHash('new') }]).reason, 'source_file_changed');
  assert.equal(kb.isPossiblyStale(entry, [{ symbol: 'foo', checksum: claims.evidenceHash('new-symbol') }]).reason, 'symbol_changed');
});

test('claim graph persists typed nodes, explains claims, and enforces retention', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-claim-graph-'));
  const file = path.join(dir, 'graph.json');
  try {
    const g = graph.createGraph();
    graph.addNode(g, 'claim:comment-bloat', 'claim', { rule_origin: 'comment-bloat', birthing_bug: 'JS block comments were invisible', preserving_tests: ['comment_bloat_audit.test.js'], retirement_condition: 'policy retired', breakage_risk: 'missed context bloat' });
    graph.addNode(g, 'test:comment-bloat', 'test');
    graph.addEdge(g, 'claim:comment-bloat', 'preserved_by', 'test:comment-bloat');
    graph.saveGraph(g, file);
    const loaded = graph.loadGraph(file);
    assert.equal(graph.explainClaim(loaded, 'claim:comment-bloat').birthing_bug, 'JS block comments were invisible');
    const retained = graph.enforceRetention(loaded, { maxNodes: 1 });
    assert.equal(retained.node_count, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('self-doubt, meta-rule, and evidence minimization audits reject ceremony and leaks', () => {
  assert.equal(audits.verifierSelfDoubtAudit({ intent_fit: 'yes', bypass_blindness: 'low', false_positive_risk: 'low', false_negative_risk: 'low', actionability: 'repair', fail_loud_mode: 'deny', ceremony_gaming_risk: 'low' }).ok, true);
  assert.equal(audits.metaRuleAudit({ warning_usefulness_proof: 'prevents stale alert', death_condition: 'superseded', repair_regression: 'test.js', lineage_purpose: 'user pain', currentness_proof: 'claim' }).ok, true);
  assert.equal(audits.evidenceDataMinimization({ messages: ['raw payload'] }).ok, false);
  assert.equal(audits.retentionPlan({ nodes: { a: {}, b: {} } }, { maxItems: 1 }).action, 'compact_or_archive');
});

test('pipeline verdict allowlist exposes nonfatal failures without hiding ownership', () => {
  const allowlist = [{ scope: 'diagnostic', owner: 'ci', reason: 'known flaky diagnostic', expires_at: '2099-01-01T00:00:00Z', regression: 'pipeline.test.js' }];
  assert.equal(activeAllowlist(allowlist).length, 1);
  const verdict = splitVerdict({ verdict: 'STABLE', failed: 1, allowlist });
  assert.equal(verdict.diagnostic_verdict, 'ALLOWLISTED_FAIL');
  assert.match(verdict.exit_policy, /fail unless/);
});
