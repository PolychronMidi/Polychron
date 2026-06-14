'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PROJECT_ROOT } = require('./shared');

const CLAIM_SCHEMA_VERSION = '1.0.0';
const STATUSES = new Set(['pass', 'warn', 'fail', 'error', 'stale', 'unknown']);
const SEVERITIES = new Set(['info', 'warn', 'blocker']);
const DEFAULT_CLAIM_DIR = path.join(PROJECT_ROOT, 'tools', 'HME', 'runtime', 'claims');

const INVALIDATOR_REGISTRY = Object.freeze({
  tracked_code_edit: { scopes: ['repo://src', 'repo://tools/HME'], effect: 'stale_matching_claims' },
  verifier_edit: { scopes: ['repo://tools/HME/scripts/verify_coherence', 'repo://tools/HME/scripts'], effect: 'stale_producer_claims' },
  policy_edit: { scopes: ['repo://tools/HME/policies', 'repo://tools/HME/proxy'], effect: 'stale_policy_claims' },
  test_edit: { scopes: ['repo://tools/HME/tests', 'repo://test'], effect: 'stale_test_proof_claims' },
  kb_source_edit: { scopes: ['repo://tools/HME/KB', 'repo://doc'], effect: 'stale_kb_claims' },
  pipeline_run: { scopes: ['repo://src/output/metrics/pipeline-summary.json'], effect: 'refresh_pipeline_claims' },
  tool_response_defect: { scopes: ['session://tool-response'], effect: 'stale_tool_quality_claims' },
  agent_launch: { scopes: ['session://agent-launch'], effect: 'refresh_or_fail_agent_fork_claims' },
});

function evidenceHash(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return 'sha256:' + crypto.createHash('sha256').update(text || '').digest('hex');
}

function _isIsoDate(value) {
  if (value === null) return true;
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function validateClaim(claim) {
  const errors = [];
  const need = ['schema_version', 'claim_id', 'subject_uri', 'producer', 'producer_version', 'status', 'severity', 'confidence', 'evidence_uri', 'evidence_hash', 'scope', 'invalidator_keys', 'generated_at', 'repair', 'regression_tests', 'retirement_condition'];
  for (const k of need) if (!(k in (claim || {}))) errors.push(`missing ${k}`);
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) errors.push('claim must be object');
  else {
    if (claim.schema_version !== CLAIM_SCHEMA_VERSION) errors.push(`unsupported schema_version ${claim.schema_version}`);
    if (typeof claim.claim_id !== 'string' || !/^[A-Za-z0-9_.:-]+$/.test(claim.claim_id)) errors.push('invalid claim_id');
    if (typeof claim.subject_uri !== 'string' || claim.subject_uri.length < 1) errors.push('invalid subject_uri');
    if (typeof claim.producer !== 'string' || claim.producer.length < 1) errors.push('invalid producer');
    if (typeof claim.producer_version !== 'string' || claim.producer_version.length < 1) errors.push('invalid producer_version');
    if (!STATUSES.has(claim.status)) errors.push('invalid status');
    if (!SEVERITIES.has(claim.severity)) errors.push('invalid severity');
    if (typeof claim.confidence !== 'number' || claim.confidence < 0 || claim.confidence > 1) errors.push('invalid confidence');
    if (typeof claim.evidence_uri !== 'string' || claim.evidence_uri.length < 1) errors.push('invalid evidence_uri');
    if (typeof claim.evidence_hash !== 'string' || !/^sha256:[a-fA-F0-9]{64}$/.test(claim.evidence_hash)) errors.push('invalid evidence_hash');
    if (!Array.isArray(claim.scope) || claim.scope.length === 0 || claim.scope.some((s) => typeof s !== 'string' || !s)) errors.push('invalid scope');
    if (!Array.isArray(claim.invalidator_keys) || claim.invalidator_keys.length === 0 || claim.invalidator_keys.some((s) => typeof s !== 'string' || !s)) errors.push('invalid invalidator_keys');
    if (!_isIsoDate(claim.generated_at)) errors.push('invalid generated_at');
    if ('expires_at' in claim && !_isIsoDate(claim.expires_at)) errors.push('invalid expires_at');
    if (typeof claim.repair !== 'string' || claim.repair.length < 1) errors.push('missing repair');
    if (!Array.isArray(claim.regression_tests)) errors.push('invalid regression_tests');
    if (typeof claim.retirement_condition !== 'string' || claim.retirement_condition.length < 1) errors.push('missing retirement_condition');
  }
  return { ok: errors.length === 0, errors };
}

function _uriMatches(scope, uri) {
  if (!scope || !uri) return false;
  return uri === scope || uri.startsWith(scope.endsWith('/') ? scope : scope + '/');
}

function isCurrent(claim, invalidators = []) {
  const validation = validateClaim(claim);
  if (!validation.ok) return { current: false, reason: 'invalid_claim', errors: validation.errors };
  const generated = Date.parse(claim.generated_at);
  if (claim.expires_at && Date.parse(claim.expires_at) <= Date.now()) return { current: false, reason: 'expired' };
  for (const inv of invalidators || []) {
    if (!inv || !claim.invalidator_keys.includes(inv.key)) continue;
    const ts = inv.ts || inv.generated_at || inv.timestamp;
    if (ts && Date.parse(ts) <= generated) continue;
    const uri = inv.subject_uri || inv.uri || inv.path || '';
    const relevant = !uri || claim.scope.some((s) => _uriMatches(s, uri));
    if (relevant) return { current: false, reason: 'invalidated', invalidator: inv };
  }
  return { current: true, reason: 'fresh' };
}

function writeClaim(claim, opts = {}) {
  const validation = validateClaim(claim);
  if (!validation.ok) throw new Error(`invalid coherence claim: ${validation.errors.join('; ')}`);
  const dir = opts.dir || DEFAULT_CLAIM_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const safe = claim.claim_id.replace(/[^A-Za-z0-9_.:-]/g, '_');
  const fp = path.join(dir, `${safe}.json`);
  fs.writeFileSync(fp, JSON.stringify(claim, null, 2) + '\n');
  return fp;
}

function readClaim(filePath) {
  const claim = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const validation = validateClaim(claim);
  if (!validation.ok) throw new Error(`invalid coherence claim: ${validation.errors.join('; ')}`);
  return claim;
}

module.exports = {
  CLAIM_SCHEMA_VERSION,
  INVALIDATOR_REGISTRY,
  validateClaim,
  evidenceHash,
  isCurrent,
  writeClaim,
  readClaim,
};
