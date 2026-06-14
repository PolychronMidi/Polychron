'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const { PROJECT_ROOT } = require('./shared');

const DEFAULT_INVALIDATOR_LOG = path.join(PROJECT_ROOT, 'tools', 'HME', 'runtime', 'claim-invalidators.jsonl');

function _hash(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return 'sha256:' + crypto.createHash('sha256').update(text || '').digest('hex');
}

function _repoUri(rel) {
  return `repo://${String(rel || '').replace(/^\/+/, '')}`;
}

function _classifyPath(rel) {
  if (/^(src|scripts)\//.test(rel) || /^tools\/HME\/(proxy|scripts|event_kernel|hooks|service)\//.test(rel)) return 'tracked_code_edit';
  if (/^tools\/HME\/policies\//.test(rel)) return 'policy_edit';
  if (/^tools\/HME\/tests\//.test(rel) || /(^|\/)test[s]?\//.test(rel) || /\.test\.(js|py)$/.test(rel)) return 'test_edit';
  if (/^tools\/HME\/KB\//.test(rel) || /^doc\//.test(rel)) return 'kb_source_edit';
  if (/verify-coherence|audit-|check-.*\.py|check-.*\.js/.test(rel)) return 'verifier_edit';
  return 'tracked_code_edit';
}

function appendInvalidator(row, opts = {}) {
  const file = opts.file || DEFAULT_INVALIDATOR_LOG;
  const full = normalizeInvalidator(row);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(full) + '\n');
  return full;
}

function normalizeInvalidator(row = {}) {
  const subject = row.subject_uri || row.uri || (row.path ? _repoUri(row.path) : 'repo://');
  return {
    schema_version: '1.0.0',
    key: row.key || 'tracked_code_edit',
    subject_uri: subject,
    path: row.path || subject.replace(/^repo:\/\//, ''),
    ts: row.ts || row.generated_at || new Date().toISOString(),
    source: row.source || 'claim_invalidators',
    evidence_hash: row.evidence_hash || _hash({ key: row.key, subject, path: row.path || '' }),
    claim_id: row.claim_id || row.superseded_claim_id || undefined,
    superseded_claim_id: row.superseded_claim_id || undefined,
    route_id: row.route_id || undefined,
    detail: row.detail || undefined,
  };
}

function readInvalidators(file = DEFAULT_INVALIDATOR_LOG) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
    try { return normalizeInvalidator(JSON.parse(line)); } catch (_e) { return null; }
  }).filter(Boolean);
}

function gitChangedInvalidators(root = PROJECT_ROOT, opts = {}) {
  const since = opts.since || 'HEAD';
  let out = '';
  try {
    out = cp.execFileSync('git', ['-C', root, 'diff', '--name-only', since, '--'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (_e) {
    try { out = cp.execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').map((l) => l.slice(3)).join('\n'); } catch (__e) { out = ''; }
  }
  return out.split('\n').map((s) => s.trim()).filter(Boolean).map((rel) => {
    let ts = new Date().toISOString();
    try { ts = fs.statSync(path.join(root, rel)).mtime.toISOString(); } catch (_e) {}
    return normalizeInvalidator({
      key: _classifyPath(rel),
      path: rel,
      subject_uri: _repoUri(rel),
      ts,
      source: 'git_worktree',
      detail: `changed since ${since}`,
    });
  });
}

function runtimeInvalidators(root = PROJECT_ROOT) {
  const rows = [];
  const maybe = [
    ['pipeline_run', 'src/output/metrics/pipeline-summary.json'],
    ['tool_response_defect', 'tools/HME/runtime/tool-response-quality.jsonl'],
    ['agent_launch', 'tools/HME/runtime/agent-launch-audit.jsonl'],
    ['claim_storage_over_cap', 'tools/HME/runtime/claim-graph.json'],
  ];
  for (const [key, rel] of maybe) {
    const fp = path.join(root, rel);
    if (!fs.existsSync(fp)) continue;
    const stat = fs.statSync(fp);
    rows.push(normalizeInvalidator({ key, path: rel, subject_uri: _repoUri(rel), ts: stat.mtime.toISOString(), source: 'runtime_mtime' }));
  }
  return rows;
}

function collectInvalidators(root = PROJECT_ROOT, opts = {}) {
  const file = opts.file || DEFAULT_INVALIDATOR_LOG;
  return [
    ...readInvalidators(file),
    ...gitChangedInvalidators(root, opts),
    ...runtimeInvalidators(root),
    ...(opts.extra || []).map(normalizeInvalidator),
  ];
}

module.exports = { DEFAULT_INVALIDATOR_LOG, normalizeInvalidator, appendInvalidator, readInvalidators, gitChangedInvalidators, runtimeInvalidators, collectInvalidators };
