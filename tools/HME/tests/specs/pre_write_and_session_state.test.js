'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function fresh(projectRoot) {
  process.env.PROJECT_ROOT = projectRoot;
  const roots = [path.resolve(__dirname, '..', '..', 'proxy'), path.resolve(__dirname, '..', '..', 'policies')];
  for (const k of Object.keys(require.cache)) {
    if (roots.some((r) => k.startsWith(r))) delete require.cache[k];
  }
}

function sandbox(prefix = 'hme-hooks-') {
  const root = fs.mkdtempSync(path.join(os.homedir(), prefix));
  const repo = path.resolve(__dirname, '..', '..', '..', '..');
  for (const d of ['src', 'tmp', 'log', 'output/metrics']) fs.mkdirSync(path.join(root, d), { recursive: true });
  for (const d of ['tools', 'scripts', 'config']) fs.symlinkSync(path.join(repo, d), path.join(root, d));
  fresh(root);
  return root;
}

async function dispatch(root, event, payload) {
  fresh(root);
  const bridge = require('../../proxy/hook_bridge');
  return bridge.dispatchEvent(event, JSON.stringify(payload || {}));
}

test('pre-write check centralizes deny decision for credential writes', async () => {
  const root = sandbox('hme-pre-write-');
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
  const root = sandbox('hme-session-state-');
  const state = require('../../proxy/session_state');
  state.recordVerificationEvidence({ command: 'node --test x', exit_code: 0, excerpt: 'pass', artifact: 'x' });
  const recent = state.recentVerificationEvidence(60_000);
  assert.strictEqual(recent.length, 1);
  assert.strictEqual(recent[0].command, 'node --test x');
  assert.strictEqual(recent[0].exit_code, 0);
  fs.rmSync(root, { recursive: true, force: true });
});


test('synthetic PreToolUse Edit denies stub content', async () => {
  const root = sandbox('hme-hook-edit-');
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
  const root = sandbox('hme-hook-bash-');
  const res = await dispatch(root, 'PreToolUse', {
    tool_name: 'Bash',
    session_id: 's3',
    tool_input: { command: 'git status --short' },
  });
  assert.strictEqual(res.exit_code, 0);
  assert.doesNotMatch(res.stdout, /permissionDecision":"deny/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('synthetic PostToolUse Bash records verification evidence', async () => {
  const root = sandbox('hme-hook-post-bash-');
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
  const root = sandbox('hme-hook-stop-');
  const res = await dispatch(root, 'Stop', { session_id: 's5' });
  assert.strictEqual(res.exit_code, 0);
  assert.strictEqual(typeof res.stdout, 'string');
  fs.rmSync(root, { recursive: true, force: true });
});

test('synthetic SessionStart returns lifecycle shape', async () => {
  const root = sandbox('hme-hook-session-');
  const res = await dispatch(root, 'SessionStart', { session_id: 's6' });
  assert.strictEqual(res.exit_code, 0);
  assert.strictEqual(typeof res.stderr, 'string');
  fs.rmSync(root, { recursive: true, force: true });
});

test('synthetic PostCompact returns lifecycle shape', async () => {
  const root = sandbox('hme-hook-postcompact-');
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
