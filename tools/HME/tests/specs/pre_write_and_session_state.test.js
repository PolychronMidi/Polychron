'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function fresh(projectRoot) {
  process.env.PROJECT_ROOT = projectRoot;
  const roots = [
    path.resolve(__dirname, '..', '..', 'proxy'),
    path.resolve(__dirname, '..', '..', 'policies'),
  ];
  for (const k of Object.keys(require.cache)) {
    if (roots.some((r) => k.startsWith(r))) delete require.cache[k];
  }
}

test('pre-write check centralizes deny decision for credential writes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-pre-write-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fresh(root);
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-session-state-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fresh(root);
  const state = require('../../proxy/session_state');
  state.recordVerificationEvidence({ command: 'node --test x', exit_code: 0, excerpt: 'pass', artifact: 'x' });
  const recent = state.recentVerificationEvidence(60_000);
  assert.strictEqual(recent.length, 1);
  assert.strictEqual(recent[0].command, 'node --test x');
  assert.strictEqual(recent[0].exit_code, 0);
  fs.rmSync(root, { recursive: true, force: true });
});
