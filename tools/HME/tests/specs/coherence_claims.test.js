'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const claims = require('../../proxy/coherence_claims');

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
    repair: 'manually condense prose comments to <=2 intent-preserving lines',
    tests: ['comment_bloat_audit.test.js'],
    retirement_condition: 'comment-bloat policy retired',
    supersedes: [],
    ...overrides,
  };
}

test('coherence claim validates required machine-checkable fields', () => {
  assert.equal(claims.validateClaim(sampleClaim()).ok, true);
  const bad = sampleClaim({ evidence_hash: 'not-a-hash' });
  const result = claims.validateClaim(bad);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /evidence_hash/);
});

test('coherence claim currentness becomes stale after scoped invalidator', () => {
  const claim = sampleClaim();
  assert.deepEqual(claims.isCurrent(claim, []).current, true);
  const stale = claims.isCurrent(claim, [{ key: 'tracked_code_edit', subject_uri: 'repo://src/foo.js', ts: '2026-06-13T00:01:00Z' }]);
  assert.equal(stale.current, false);
  assert.equal(stale.reason, 'invalidated');
});

test('coherence claim ignores older and out-of-scope invalidators', () => {
  const claim = sampleClaim();
  assert.equal(claims.isCurrent(claim, [{ key: 'tracked_code_edit', subject_uri: 'repo://src/foo.js', ts: '2026-06-12T00:00:00Z' }]).current, true);
  assert.equal(claims.isCurrent(claim, [{ key: 'tracked_code_edit', subject_uri: 'repo://doc/foo.md', ts: '2026-06-13T00:01:00Z' }]).current, true);
});

test('coherence claim writer rejects invalid claims and round-trips valid claims', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-claims-'));
  try {
    assert.throws(() => claims.writeClaim(sampleClaim({ repair: '' }), { dir }), /invalid coherence claim/);
    const fp = claims.writeClaim(sampleClaim(), { dir });
    assert.equal(claims.readClaim(fp).claim_id, 'comment-bloat.fail-count.zero');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
