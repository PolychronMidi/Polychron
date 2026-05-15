'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ORIGINAL_PATH = process.env.PATH || '';

function fresh(projectRoot) {
  process.env.PROJECT_ROOT = projectRoot;
  process.env.PATH = path.join(projectRoot, 'bin') + path.delimiter + ORIGINAL_PATH;
  const roots = [
    path.resolve(__dirname, '..', '..', 'event_kernel'),
    path.resolve(__dirname, '..', '..', 'hooks'),
    path.resolve(__dirname, '..', '..', 'proxy'),
    path.resolve(__dirname, '..', '..', 'policies'),
  ];
  for (const k of Object.keys(require.cache)) {
    if (roots.some((r) => k.startsWith(r))) delete require.cache[k];
  }
}

function _withSandbox(prefix = 'hme-hooks-') {
  const repo = path.resolve(__dirname, '..', '..', '..', '..');
  const base = path.join(os.tmpdir(), 'hme-test-sandboxes');
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, prefix));
  for (const d of ['src', 'tmp', 'log', 'output/metrics', '.git', 'bin']) fs.mkdirSync(path.join(root, d), { recursive: true });
  for (const d of ['tools', 'scripts', 'config']) fs.symlinkSync(path.join(repo, d), path.join(root, d));
  fs.writeFileSync(path.join(root, 'README.md'), 'test sandbox\n');
  const fakeGit = path.join(root, 'bin', 'git');
  fs.writeFileSync(fakeGit, [
    '#!/usr/bin/env bash',
    'if [ "$1" = "-C" ]; then shift 2; fi',
    'case "$1" in add|commit|diff|status) exit 0 ;; *) exit 0 ;; esac',
    '',
  ].join('\n'));
  fs.chmodSync(fakeGit, 0o755);
  fresh(root);
  return root;
}

async function dispatch(root, event, payload) {
  fresh(root);
  const bridge = require('../../event_kernel/dispatcher');
  return bridge.dispatchEvent(event, JSON.stringify({ cwd: root, ...(payload || {}) }));
}

test('pre-write check centralizes deny decision for credential writes', async () => {
  const root = _withSandbox('hme-pre-write-');
  const { preWriteCheck } = require('../../proxy/pre_write_check');
  const decision = await preWriteCheck(JSON.stringify({
    tool_name: 'Write',
    session_id: 's1',
    tool_input: { file_path: path.join(root, 'id_rsa'), content: 'x' },
  }));
  assert.strictEqual(decision.permissionDecision, 'deny');
  assert.match(decision.reason, /credential filename/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('session state records structured verification evidence', () => {
  const root = _withSandbox('hme-session-state-');
  const state = require('../../proxy/session_state');
  state.recordVerificationEvidence({ command: 'node --test x', exit_code: 0, excerpt: 'pass', artifact: 'x' });
  const recent = state.recentVerificationEvidence(60_000);
  assert.strictEqual(recent.length, 1);
  assert.strictEqual(recent[0].command, 'node --test x');
  assert.strictEqual(recent[0].exit_code, 0);
  fs.rmSync(root, { recursive: true, force: true });
});


test('synthetic PreToolUse Edit denies stub content', async () => {
  const root = _withSandbox('hme-hook-edit-');
  const res = await dispatch(root, 'PreToolUse', {
    tool_name: 'Edit',
    session_id: 's2',
    tool_input: { file_path: path.join(root, 'src', 'x.js'), new_string: '// prev' + 'ious implementation' },
  });
  assert.match(res.stdout, /permissionDecision":"deny/);
  assert.match(res.stdout, /stub placeholder/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('synthetic PreToolUse Bash no-ops on harmless command', async () => {
  const root = _withSandbox('hme-hook-bash-');
  const res = await dispatch(root, 'PreToolUse', {
    tool_name: 'Bash',
    session_id: 's3',
    tool_input: { command: 'git status --short' },
  });
  assert.notStrictEqual(res.exit_code, 127);
  assert.doesNotMatch(res.stdout, /permissionDecision":"deny/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('synthetic PostToolUse Bash records verification evidence', async () => {
  const root = _withSandbox('hme-hook-post-bash-');
  const res = await dispatch(root, 'PostToolUse', {
    tool_name: 'Bash',
    session_id: 's4',
    tool_input: { command: 'node --test synthetic.test.js' },
    tool_response: { exit_code: 0, stdout: 'pass' },
  });
  const state = require('../../proxy/session_state').readState('s4');
  assert.strictEqual(res.exit_code, 0);
  assert.ok(state.verification_evidence.some((e) => e.command.includes('synthetic.test.js')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('synthetic Stop chain policy returns decision shape', async () => {
  const root = _withSandbox('hme-hook-stop-');
  const res = await dispatch(root, 'Stop', { session_id: 's5' });
  assert.strictEqual(res.exit_code, 0);
  assert.strictEqual(typeof res.stdout, 'string');
  fs.rmSync(root, { recursive: true, force: true });
});

test('synthetic SessionStart returns lifecycle shape', async () => {
  const root = _withSandbox('hme-hook-session-');
  const res = await dispatch(root, 'SessionStart', { session_id: 's6' });
  assert.strictEqual(res.exit_code, 0);
  assert.strictEqual(typeof res.stderr, 'string');
  fs.rmSync(root, { recursive: true, force: true });
});

test('synthetic PostCompact returns lifecycle shape', async () => {
  const root = _withSandbox('hme-hook-postcompact-');
  const res = await dispatch(root, 'PostCompact', { session_id: 's7' });
  assert.strictEqual(res.exit_code, 0);
  assert.strictEqual(typeof res.stdout, 'string');
  fs.rmSync(root, { recursive: true, force: true });
});

test('synthetic autocommit direct fallback script exists', () => {
  const script = path.resolve(__dirname, '..', '..', 'hooks', 'direct', 'autocommit-direct.sh');
  assert.ok(fs.existsSync(script));
  assert.ok(fs.statSync(script).mode & 0o111);
});


test('hook envelope normalizes JSON string tool_input', () => {
  const { normalize } = require('../../event_kernel/envelope');
  const env = normalize(JSON.stringify({
    session_id: 's8',
    tool_name: 'Write',
    tool_input: JSON.stringify({ file_path: '/tmp/x.js', content: 'const x = 1;' }),
  }));
  assert.strictEqual(env.session_id, 's8');
  assert.strictEqual(env.file_path, '/tmp/x.js');
  assert.strictEqual(env.content, 'const x = 1;');
});

test('session-state client uses filesystem path before HTTP fallback', async () => {
  const root = _withSandbox('hme-state-client-');
  const client = require('../../proxy/session_state_client');
  await client.call('verification-evidence', 's9', { command: 'probe', exit_code: 0, excerpt: 'ok' });
  const state = require('../../proxy/session_state').readState('s9');
  assert.ok(state.verification_evidence.some((e) => e.command === 'probe'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('synthetic hooks manifest maps lifecycle through Claude adapter', () => {
  const hooksPath = path.resolve(__dirname, '..', '..', 'hooks', 'hooks.json');
  const data = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
  for (const event of ['PreToolUse', 'PostToolUse', 'Stop', 'SessionStart', 'PostCompact']) {
    const entries = data.hooks[event] || [];
    const text = JSON.stringify(entries);
    assert.match(text, /event_kernel\/claude_adapter\.js/);
  }
});
