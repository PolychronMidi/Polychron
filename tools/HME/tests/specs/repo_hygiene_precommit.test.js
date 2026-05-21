'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const canonicalHook = path.join(PROJECT_ROOT, 'tools/HME/git-hooks/pre-commit');
const canonicalPostCommitHook = path.join(PROJECT_ROOT, 'tools/HME/git-hooks/post-commit');
const validator = path.join(PROJECT_ROOT, 'tools/HME/scripts/precommit_validate.py');
const policyPath = path.join(PROJECT_ROOT, 'tools/HME/config/repo-hygiene.json');
const installer = path.join(PROJECT_ROOT, 'tools/HME/scripts/install-git-hooks.sh');

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout: 20000,
    cwd: PROJECT_ROOT,
    env: { ...process.env, PROJECT_ROOT, ...(opts.env || {}) },
  });
}

test('repo hygiene policy exists and declares canonical precommit assets', () => {
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  assert.equal(policy.canonical_precommit, 'tools/HME/git-hooks/pre-commit');
  assert.equal(policy.canonical_post_commit, 'tools/HME/git-hooks/post-commit');
  assert.equal(policy.precommit_validator, 'tools/HME/scripts/precommit_validate.py');
  assert.ok(policy.blocked_paths.includes('tools/HME/runtime/**'));
  assert.ok(policy.blocked_paths.includes('**/session-state.json'));
});

test('canonical precommit hook delegates to tracked validator', () => {
  const hook = fs.readFileSync(canonicalHook, 'utf8');
  assert.match(hook, /SECRETS ABOVE THIS LINE/);
  assert.match(hook, /precommit_validate\.py/);
  assert.match(hook, /check-root-only-dirs\.js/);
  const st = fs.statSync(canonicalHook);
  assert.ok(st.mode & 0o100, 'canonical hook must be executable');
});

test('precommit validator imports shared path policy and keeps literal local sentinels out of source', () => {
  const body = fs.readFileSync(validator, 'utf8');
  assert.match(body, /from path_policy import blocked_path_reason/);
  assert.match(body, /secret_hits/);
  assert.match(body, /has_conflict_markers/);
  assert.doesNotMatch(body, new RegExp(`${path.sep}home${path.sep}jah${path.sep}`));
  assert.doesNotMatch(body, new RegExp(`${path.sep}m${'nt'}${path.sep}`));
});

test('hook installer is executable and points at canonical hooks', () => {
  const body = fs.readFileSync(installer, 'utf8');
  assert.match(body, /tools\/HME\/git-hooks\/pre-commit/);
  assert.match(body, /tools\/HME\/git-hooks\/post-commit/);
  assert.ok(fs.statSync(installer).mode & 0o100, 'installer must be executable');
});

test('canonical post-commit hook records reload need without synchronous proxy restart', () => {
  const hook = fs.readFileSync(canonicalPostCommitHook, 'utf8');
  assert.match(hook, /post-commit-proxy-reload-needed/);
  assert.match(hook, /not restarting synchronously/);
  assert.doesNotMatch(hook, /proxy-supervisor\.sh/);
  assert.ok(fs.statSync(canonicalPostCommitHook).mode & 0o100, 'canonical post-commit hook must be executable');
});

test('canonical hook and validator parse', () => {
  let r = run('bash', ['-n', canonicalHook]);
  assert.equal(r.status, 0, r.stderr);
  r = run('bash', ['-n', canonicalPostCommitHook]);
  assert.equal(r.status, 0, r.stderr);
  r = run('python3', ['-m', 'py_compile', validator, path.join(PROJECT_ROOT, 'tools/HME/scripts/path_policy.py')]);
  assert.equal(r.status, 0, r.stderr);
});

test('canonical precommit verifier passes', () => {
  const code = `import sys; sys.path.insert(0, '${path.join(PROJECT_ROOT, 'tools/HME/scripts')}'); from verify_coherence.repo_hygiene import CanonicalPrecommitHookVerifier; r=CanonicalPrecommitHookVerifier().execute(); print(r.status); print(r.summary); raise SystemExit(0 if r.status == 'PASS' else 1)`;
  const r = run('python3', ['-c', code], { env: { HME_METRICS_DIR: path.join(PROJECT_ROOT, 'src/output/metrics') } });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /PASS/);
});
