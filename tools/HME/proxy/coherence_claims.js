'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PROJECT_ROOT } = require('./shared');

const CLAIM_SCHEMA_VERSION = '1.0.0';
const STATUSES = new Set(['pass', 'warn', 'fail', 'error', 'stale', 'unknown']);
const SEVERITIES = new Set(['info', 'warn', 'blocker']);
const DEFAULT_CLAIM_DIR = path.join(PROJECT_ROOT, 'tools', 'HME', 'runtime', 'claims');
const MAX_BOUNDED_STRING = 4096;

const INVALIDATOR_REGISTRY = Object.freeze({
  tracked_code_edit: { scopes: ['repo://src', 'repo://tools/HME'], effect: 'stale_matching_claims' },
  verifier_edit: { scopes: ['repo://tools/HME/scripts/verify_coherence', 'repo://tools/HME/scripts'], effect: 'stale_producer_claims' },
  policy_edit: { scopes: ['repo://tools/HME/policies', 'repo://tools/HME/proxy'], effect: 'stale_policy_claims' },
  test_edit: { scopes: ['repo://tools/HME/tests', 'repo://test'], effect: 'stale_test_proof_claims' },
  kb_source_edit: { scopes: ['repo://tools/HME/KB', 'repo://doc'], effect: 'stale_kb_claims' },
  pipeline_run: { scopes: ['repo://src/output/metrics/pipeline-summary.json'], effect: 'refresh_pipeline_claims' },
  tool_response_defect: { scopes: ['session://tool-response'], effect: 'stale_tool_quality_claims' },
  agent_launch: { scopes: ['session://agent-launch'], effect: 'refresh_or_fail_agent_fork_claims' },
  claim_superseded: { scopes: ['repo://tools/HME/runtime/claims'], effect: 'stale_superseded_claims' },
  evidence_secret_detected: { scopes: ['repo://tools/HME/runtime'], effect: 'invalidate_leaky_evidence' },
  claim_storage_over_cap: { scopes: ['repo://tools/HME/runtime/claims'], effect: 'enforce_retention' },
});

function evidenceHash(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return 'sha256:' + crypto.createHash('sha256').update(text || '').digest('hex');
}

function _isIsoDate(value) {
  if (value === null) return true;
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function _claimTests(claim) {
  return claim && (claim.tests || claim.regression_tests);
}

function _isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function _repoUriFromPath(value) {
  if (!value || typeof value !== 'string') return '';
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) return value;
  return `repo://${value.replace(/^\/+/, '')}`;
}

function _uriMatches(scope, uri) {
  if (!scope || !uri) return false;
  const normalized = _repoUriFromPath(uri);
  return normalized === scope || normalized.startsWith(scope.endsWith('/') ? scope : `${scope}/`);
}

function _scopesOverlap(a, b) {
  return _uriMatches(a, b) || _uriMatches(b, a);
}

function _secretFindings(value, prefix = '$', out = []) {
  if (value === null || value === undefined) return out;
  if (typeof value === 'string') {
    if (value.length > MAX_BOUNDED_STRING) out.push(`${prefix}: unbounded string evidence`);
    if (/(AKIA[0-9A-Z]{16}|BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY|xox[baprs]-|sk-[A-Za-z0-9_-]{20,})/.test(value)) out.push(`${prefix}: secret-looking string`);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => _secretFindings(v, `${prefix}[${i}]`, out));
    return out;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (/^(raw_prompt|raw_request|raw_response|request_payload|response_payload|messages|api_key|password|secret|private_key|authorization)$/i.test(k)) {
        out.push(`${prefix}.${k}: forbidden raw/sensitive evidence key`);
        continue;
      }
      _secretFindings(v, `${prefix}.${k}`, out);
    }
  }
  return out;
}

function dataMinimizationErrors(claim) {
  const errors = [];
  if (!claim || typeof claim !== 'object') return ['claim must be object'];
  if (typeof claim.evidence_uri === 'string' && /(^\/tmp\/|^file:\/\/|\.jsonl$)/.test(claim.evidence_uri)) errors.push('evidence_uri must be a bounded repo/session URI, not raw local/log payload');
  const evidenceLike = {};
  for (const k of ['metadata', 'freshness_proof', 'evidence', 'telemetry']) {
    if (k in claim) evidenceLike[k] = claim[k];
  }
  errors.push(..._secretFindings(evidenceLike));
  return errors;
}

function validateFreshnessProof(proof, claim) {
  const errors = [];
  if (!_isPlainObject(proof)) return ['missing freshness_proof'];
  if (typeof proof.kind !== 'string' || !proof.kind) errors.push('invalid freshness_proof.kind');
  if (!_isIsoDate(proof.generated_at)) errors.push('invalid freshness_proof.generated_at');
  if (typeof proof.evidence_hash !== 'string' || !/^sha256:[a-fA-F0-9]{64}$/.test(proof.evidence_hash)) errors.push('invalid freshness_proof.evidence_hash');
  if (claim && proof.evidence_hash && claim.evidence_hash && proof.evidence_hash !== claim.evidence_hash) errors.push('freshness_proof evidence_hash mismatch');
  return errors;
}

function validateClaim(claim) {
  const errors = [];
  const need = ['schema_version', 'claim_id', 'subject_uri', 'producer', 'producer_version', 'status', 'severity', 'confidence', 'evidence_uri', 'evidence_hash', 'scope', 'invalidator_keys', 'generated_at', 'freshness_proof', 'repair', 'tests', 'retirement_condition'];
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
    if (!Array.isArray(_claimTests(claim)) || _claimTests(claim).some((s) => typeof s !== 'string' || !s)) errors.push('invalid tests');
    if (typeof claim.retirement_condition !== 'string' || claim.retirement_condition.length < 1) errors.push('missing retirement_condition');
    if ('supersedes' in claim && !Array.isArray(claim.supersedes)) errors.push('invalid supersedes');
    if ('superseded_by' in claim && claim.superseded_by !== null && typeof claim.superseded_by !== 'string') errors.push('invalid superseded_by');
    errors.push(...validateFreshnessProof(claim.freshness_proof, claim));
    errors.push(...dataMinimizationErrors(claim));
  }
  return { ok: errors.length === 0, errors };
}

function _invalidatorTimestampAfterClaim(inv, generated) {
  const ts = inv && (inv.ts || inv.generated_at || inv.timestamp);
  if (!ts) return true;
  const parsed = Date.parse(ts);
  if (Number.isNaN(parsed)) return true;
  return parsed > generated;
}

function _invalidatorRelevant(claim, inv) {
  if (!inv || typeof inv !== 'object') return false;
  const uri = inv.subject_uri || inv.uri || inv.path || '';
  if (uri) return claim.scope.some((s) => _uriMatches(s, uri));
  const reg = INVALIDATOR_REGISTRY[inv.key];
  if (!reg) return true;
  return reg.scopes.some((rs) => claim.scope.some((cs) => _scopesOverlap(cs, rs)));
}

function _supersedesClaim(inv, claim) {
  if (!inv || !claim) return false;
  if (inv.key === 'claim_superseded' && (inv.claim_id === claim.claim_id || inv.superseded_claim_id === claim.claim_id)) return true;
  if (Array.isArray(inv.supersedes) && inv.supersedes.includes(claim.claim_id)) return true;
  return false;
}

function isCurrent(claim, invalidators = []) {
  const validation = validateClaim(claim);
  if (!validation.ok) return { current: false, reason: 'invalid_claim', errors: validation.errors };
  const generated = Date.parse(claim.generated_at);
  if (claim.superseded_by) return { current: false, reason: 'superseded', superseded_by: claim.superseded_by };
  if (claim.expires_at && Date.parse(claim.expires_at) <= Date.now()) return { current: false, reason: 'expired' };
  for (const inv of invalidators || []) {
    if (!inv || typeof inv !== 'object') continue;
    if (!_invalidatorTimestampAfterClaim(inv, generated)) continue;
    if (_supersedesClaim(inv, claim)) return { current: false, reason: 'superseded', invalidator: inv };
    const relevant = _invalidatorRelevant(claim, inv);
    if (!relevant) continue;
    if (!inv.key || !INVALIDATOR_REGISTRY[inv.key]) return { current: false, reason: 'unknown_relevant_invalidator', invalidator: inv };
    if (!claim.invalidator_keys.includes(inv.key)) return { current: false, reason: 'untracked_relevant_invalidator', invalidator: inv };
    return { current: false, reason: 'invalidated', invalidator: inv };
  }
  return { current: true, reason: 'fresh' };
}

function currentnessState(claim, invalidators = []) {
  const validation = validateClaim(claim);
  if (!validation.ok) return { state: 'invalid', current: false, validation };
  const currentness = isCurrent(claim, invalidators);
  return { state: currentness.current ? 'current' : 'stale', current: currentness.current, validation, currentness };
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

function readClaimState(filePath, invalidators = []) {
  try {
    const claim = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const state = currentnessState(claim, invalidators);
    return { ...state, claim, file: filePath };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { state: 'missing', current: false, error: error.message, file: filePath };
    return { state: 'invalid', current: false, error: error.message, file: filePath };
  }
}

function readClaim(filePath) {
  const state = readClaimState(filePath);
  if (state.state === 'invalid' || state.state === 'missing') throw new Error(`invalid coherence claim: ${state.error || (state.validation && state.validation.errors.join('; '))}`);
  return state.claim;
}

module.exports = {
  CLAIM_SCHEMA_VERSION,
  INVALIDATOR_REGISTRY,
  validateClaim,
  validateFreshnessProof,
  dataMinimizationErrors,
  evidenceHash,
  isCurrent,
  currentnessState,
  writeClaim,
  readClaim,
  readClaimState,
};
