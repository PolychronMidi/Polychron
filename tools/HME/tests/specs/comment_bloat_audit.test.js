'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..', '..', '..', '..');
const script = path.join(repo, 'tools/HME/scripts/audit-comment-bloat.py');
const claims = require('../../proxy/coherence_claims');

function runOn(file, extraArgs = []) {
  const env = { ...process.env, PROJECT_ROOT: repo, COMMENT_BLOAT_WARN: '3', COMMENT_BLOAT_FAIL: '5', COMMENT_BLOAT_LONG_LINE: '90' };
  const r = spawnSync('python3', [script, '--json', ...extraArgs, '--files', file], { cwd: repo, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('comment-bloat audit counts JS prose block comments', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-comment-bloat-'));
  try {
    const file = path.join(dir, 'sample.js');
    fs.writeFileSync(file, [
      'const a = 1;',
      '/**',
      ' * prose one',
      ' * prose two',
      ' * prose three',
      ' * prose four',
      ' * prose five',
      ' */',
      '',
    ].join('\n'));
    const d = runOn(file);
    assert.equal(d.fail.length, 1);
    assert.equal(d.fail[0].block_len, 7);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('comment-bloat audit exempts JSDoc type metadata blocks and long type lines', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-comment-bloat-'));
  try {
    const file = path.join(dir, 'types.js');
    fs.writeFileSync(file, [
      'const a = 1;',
      '/**',
      ' * @typedef {Object} Thing',
      ' * @property {string} extremelyLongPropertyNameForInterfaceMetadata - this is type metadata and should not be prose bloat even when long',
      ' * @property {number} size - metadata',
      ' * @property {boolean} ready - metadata',
      ' * @property {string} other - metadata',
      ' */',
      '',
    ].join('\n'));
    const d = runOn(file);
    assert.equal(d.fail.length, 0);
    assert.equal(d.long_lines.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('comment-bloat audit --claim emits a schema-shaped claim file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-comment-bloat-'));
  const claimFile = path.join(repo, 'tools/HME/runtime/claims/comment-bloat.fail-count.zero.json');
  try {
    const file = path.join(dir, 'clean.js');
    fs.writeFileSync(file, 'const a = 1;\n// short rationale\n');
    runOn(file, ['--claim']);
    const claim = JSON.parse(fs.readFileSync(claimFile, 'utf8'));
    assert.equal(claim.claim_id, 'comment-bloat.fail-count.zero');
    assert.equal(claim.status, 'pass');
    assert.match(claim.evidence_hash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(claims.validateClaim(claim).ok, true);
    assert.equal(claim.freshness_proof.evidence_hash, claim.evidence_hash);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(claimFile, { force: true });
  }
});

test('comment-bloat generated marker exempts generated prose blocks only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-comment-bloat-'));
  try {
    const generated = path.join(dir, 'generated.js');
    fs.writeFileSync(generated, [
      'const a = 1;',
      '/**',
      ' * @generated',
      ' * generated detail one',
      ' * generated detail two',
      ' * generated detail three',
      ' * generated detail four',
      ' */',
      '',
    ].join('\n'));
    assert.equal(runOn(generated).fail.length, 0);
    const prose = path.join(dir, 'prose.js');
    fs.writeFileSync(prose, fs.readFileSync(generated, 'utf8').replace(' * @generated\n', ''));
    assert.equal(runOn(prose).fail.length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('comment-bloat claim becomes stale after scoped edit and current after rerun', () => {
  const oldClaim = {
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
    freshness_proof: { kind: 'audit_run', generated_at: '2026-06-13T00:00:00Z', evidence_hash: claims.evidenceHash({ fail: 0 }) },
    repair: 'manual condensation',
    tests: ['comment_bloat_audit.test.js'],
    retirement_condition: 'policy retired',
    supersedes: [],
  };
  assert.equal(claims.isCurrent(oldClaim, [{ key: 'tracked_code_edit', subject_uri: 'repo://src/a.js', ts: '2026-06-13T00:01:00Z' }]).current, false);
  const refreshed = { ...oldClaim, generated_at: '2026-06-13T00:02:00Z', freshness_proof: { ...oldClaim.freshness_proof, generated_at: '2026-06-13T00:02:00Z' } };
  assert.equal(claims.isCurrent(refreshed, [{ key: 'tracked_code_edit', subject_uri: 'repo://src/a.js', ts: '2026-06-13T00:01:00Z' }]).current, true);
});
