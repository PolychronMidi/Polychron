'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function _withSandbox(prefix) {
  const base = path.join(os.tmpdir(), 'hme-test-sandboxes');
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, prefix));
  for (const d of ['src', 'tmp', 'log', 'src/output/metrics', '.git', 'bin']) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
  for (const d of ['tools', 'scripts', 'config']) {
    fs.symlinkSync(path.join(REPO_ROOT, d), path.join(root, d));
  }
  const fakeGit = path.join(root, 'bin', 'git');
  fs.writeFileSync(fakeGit, '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(fakeGit, 0o755);
  return root;
}

test('policy_rewrite telemetry: emits row to hme-activity.jsonl on rewrite', async () => {
  const root = _withSandbox('hme-policy-telem-');
  process.env.PROJECT_ROOT = root;
  process.env.HME_RUNTIME_DIR = path.join(root, 'tmp', 'hme-runtime');
  for (const k of Object.keys(require.cache)) {
    if (k.includes('/tools/HME/event_kernel/') || k.includes('/tools/HME/proxy/')) delete require.cache[k];
  }
  const { preWriteCheck } = require('../../proxy/pre_write_check');
  const target = path.join(root, 'src', 'probe.sh');
  const content = `echo "${root}/tools/HME/i/status"\n`;
  const decision = await preWriteCheck(JSON.stringify({
    tool_name: 'Write',
    session_id: 's-telem',
    tool_input: { file_path: target, content },
  }));
  assert.strictEqual(decision.permissionDecision, 'allow');
  const activityPath = path.join(process.env.HME_RUNTIME_DIR, 'metrics', 'hme-activity.jsonl');
  assert.ok(fs.existsSync(activityPath), 'activity log should be written');
  const rows = fs.readFileSync(activityPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const rewriteRow = rows.find((r) => r.kind === 'policy_rewrite');
  assert.ok(rewriteRow, 'should have a policy_rewrite row');
  assert.equal(rewriteRow.tool, 'Write');
  assert.ok(Array.isArray(rewriteRow.policies));
  assert.ok(rewriteRow.policies.includes('rewrite-hardcoded-project-root'));
  assert.match(rewriteRow.last_message, /DDoC stripped: hardcoded project root/);
  fs.rmSync(root, { recursive: true, force: true });
});
