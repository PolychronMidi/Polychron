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

function _fresh(root) {
  process.env.PROJECT_ROOT = root;
  process.env.HME_RUNTIME_DIR = path.join(root, 'tmp', 'hme-runtime');
  fs.mkdirSync(process.env.HME_RUNTIME_DIR, { recursive: true });
  for (const k of Object.keys(require.cache)) {
    if (k.includes('/tools/HME/event_kernel/') || k.includes('/tools/HME/proxy/') || k.includes('/tools/HME/policies/')) delete require.cache[k];
  }
}

test('codex Agent dispatch: auto-fill-agent-description rewrites missing description', async () => {
  const root = _withSandbox('hme-codex-agent-desc-');
  _fresh(root);
  const { dispatchEvent } = require('../../event_kernel/dispatcher');
  const payload = {
    cwd: root,
    _hme_host: 'codex',
    _hme_synthetic_tool: true,
    session_id: 'codex-agent-desc',
    tool_name: 'Agent',
    tool_input: { prompt: 'Audit parser edge cases', level: 2 },
  };
  const res = await dispatchEvent('PreToolUse', JSON.stringify(payload));
  assert.equal(res.exit_code, 0);
  const out = JSON.parse(res.stdout);
  const hso = out.hookSpecificOutput || {};
  assert.equal(hso.permissionDecision, 'allow');
  assert.ok(hso.updatedInput, 'should have updatedInput from rewrite');
  assert.equal(hso.updatedInput.description, 'Audit parser edge cases');
  assert.equal(hso.updatedInput.prompt, 'Audit parser edge cases');
  assert.equal(hso.updatedInput.level, 2);
  assert.match(hso.additionalContext, /auto-filled Agent.description/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('codex Agent dispatch: emits policy_rewrite telemetry to hme-activity.jsonl', async () => {
  const root = _withSandbox('hme-codex-agent-telem-');
  _fresh(root);
  const { dispatchEvent } = require('../../event_kernel/dispatcher');
  await dispatchEvent('PreToolUse', JSON.stringify({
    cwd: root,
    _hme_host: 'codex',
    _hme_synthetic_tool: true,
    session_id: 'codex-agent-telem',
    tool_name: 'Agent',
    tool_input: { prompt: 'Spot-check the rewriter', level: 3 },
  }));
  const activityPath = path.join(process.env.HME_RUNTIME_DIR, 'hook-decisions.jsonl');
  assert.ok(fs.existsSync(activityPath), 'hook-decisions log should exist after dispatch');
  const rows = fs.readFileSync(activityPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const rewriteRow = rows.find((r) => r.kind === 'policy_rewrite' && r.tool === 'Agent');
  assert.ok(rewriteRow, 'should have an Agent policy_rewrite row');
  assert.equal(rewriteRow.host, 'codex');
  assert.ok(rewriteRow.policies.includes('auto-fill-agent-description'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('codex bridge pre() applies updatedInput to input object via Object.assign', async () => {
  const root = _withSandbox('hme-codex-bridge-pre-');
  _fresh(root);
  // Simulate the bridge's pre() flow inline. The real bridge calls
  // dispatchEvent and applies updatedInput via Object.assign(input, ...).
  const { dispatchEvent } = require('../../event_kernel/dispatcher');
  const input = { prompt: 'Investigate ack-skip gate', level: 4 };
  const res = await dispatchEvent('PreToolUse', JSON.stringify({
    cwd: root,
    _hme_host: 'codex',
    _hme_synthetic_tool: true,
    session_id: 'codex-bridge-pre',
    tool_name: 'Agent',
    tool_input: input,
  }));
  const hso = JSON.parse(res.stdout).hookSpecificOutput || {};
  if (hso.updatedInput) Object.assign(input, hso.updatedInput);
  assert.equal(input.description, 'Investigate ack-skip gate');
  assert.equal(input.prompt, 'Investigate ack-skip gate');
  assert.equal(input.level, 4);
  fs.rmSync(root, { recursive: true, force: true });
});
