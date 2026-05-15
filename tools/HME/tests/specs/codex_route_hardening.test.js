'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const originalPath = process.env.PATH || '';

function fresh(projectRoot) {
  process.env.PROJECT_ROOT = projectRoot;
  process.env.PATH = path.join(projectRoot, 'bin') + path.delimiter + originalPath;
  for (const k of Object.keys(require.cache)) {
    if (k.includes('/tools/HME/event_kernel/') || k.includes('/tools/HME/proxy/')) delete require.cache[k];
  }
}

function sandbox(prefix = 'codex-hardening-') {
  const base = path.join(os.tmpdir(), 'hme-test-sandboxes');
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, prefix));
  for (const d of ['src', 'tmp', 'log', 'output/metrics', '.git', 'bin']) fs.mkdirSync(path.join(root, d), { recursive: true });
  for (const d of ['tools', 'scripts', 'config']) fs.symlinkSync(path.join(repoRoot, d), path.join(root, d));
  const fakeGit = path.join(root, 'bin', 'git');
  fs.writeFileSync(fakeGit, '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(fakeGit, 0o755);
  fresh(root);
  return root;
}

async function dispatch(root, tool, input) {
  fresh(root);
  const { dispatchEvent } = require('../../event_kernel/dispatcher');
  return dispatchEvent('PreToolUse', JSON.stringify({
    cwd: root,
    _hme_host: 'codex',
    tool_name: tool,
    tool_input: input,
    session_id: `codex-${tool}`,
  }));
}

test('raw-streak policy is shared config for JS renderer', () => {
  const { loadPolicy, blockMessage } = require('../../event_kernel/native_hooks/raw_streak_policy');
  const policy = loadPolicy();
  assert.equal(policy.cost_summary, 'Bash=15, Grep=20; native Read/Edit reset');
  assert.match(blockMessage(75, 70), /native Read\/Edit reset/);
});

test('Codex hook decision compact logs hash/channels without raw reason text', () => {
  const root = sandbox('codex-decision-');
  const { sanitizeStdout, recordHookDecision } = require('../../event_kernel/codex_adapter');
  const reason = 'BLOCKED: secret reason payload';
  const raw = JSON.stringify({
    hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: reason },
    systemMessage: reason,
  });
  const clean = sanitizeStdout('PreToolUse', raw);
  recordHookDecision(root, 'PreToolUse', raw, clean, { tool_name: 'Bash', session_id: 's1' });
  const log = fs.readFileSync(path.join(root, 'runtime', 'hme', 'hook-decisions.jsonl'), 'utf8');
  const row = JSON.parse(log.trim());
  assert.equal(row.duplicate_systemMessage_stripped, true);
  assert.deepEqual(row.surfaced_channels, ['permissionDecisionReason']);
  assert.doesNotMatch(log, /secret reason payload/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Codex PreToolUse payload fixtures route for Read/Grep/Edit/Write', async () => {
  const root = sandbox('codex-payloads-');
  const file = path.join(root, 'src', 'fixture.js');
  fs.writeFileSync(file, 'const x = 1;\n');
  fs.mkdirSync(path.join(root, 'tmp', 'hme-streak'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tmp', 'hme-streak', 'codex-Read.score'), '20');
  const read = await dispatch(root, 'Read', { file_path: file });
  assert.equal(read.exit_code, 0);
  const signals = fs.readFileSync(path.join(root, 'output', 'metrics', 'hme-signals.jsonl'), 'utf8');
  assert.match(signals, /raw_streak_reset/);
  const grep = await dispatch(root, 'Grep', { pattern: 'const', path: path.join(root, 'src'), output_mode: 'files_with_matches' });
  assert.equal(grep.exit_code, 0);
  const edit = await dispatch(root, 'Edit', { file_path: file, old_string: 'const x = 1;\n', new_string: 'const x = 2;\n' });
  assert.equal(edit.exit_code, 0);
  const write = await dispatch(root, 'Write', { file_path: path.join(root, 'src', 'new.js'), content: 'export const y = 1;\n' });
  assert.equal(write.exit_code, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('codex-route and hook-decision status views are compact and API-only', () => {
  const root = sandbox('codex-status-');
  fs.mkdirSync(path.join(root, 'runtime', 'hme'), { recursive: true });
  fs.writeFileSync(path.join(root, 'runtime', 'hme', 'codex-proxy-events.jsonl'), `${JSON.stringify({ kind: 'request', route: 'omniroute', upstream: 'http://127.0.0.1:20128/v1/responses', after: { model: 'gpt-5.5' } })}\n${JSON.stringify({ kind: 'response', route: 'omniroute', status: 200, model: 'cx/gpt-5.5' })}\n`);
  fs.writeFileSync(path.join(root, 'runtime', 'hme', 'hook-decisions.jsonl'), `${JSON.stringify({ ts: 't', host: 'codex', event: 'PreToolUse', tool: 'Bash', decision: 'deny', reason_hash: 'abc', surfaced_channels: ['permissionDecisionReason'], duplicate_systemMessage_stripped: true })}\n`);
  const script = `
import importlib.util, os, sys, types
os.environ['HME_CODEX_ROUTE_SMOKE_ACTIVE'] = '0'
server = types.ModuleType('server')
server.context = types.SimpleNamespace(PROJECT_ROOT='${root}')
sys.modules['server'] = server
sys.modules['server.context'] = server.context
spec = importlib.util.spec_from_file_location('m', '${path.join(repoRoot, 'tools', 'HME', 'service', 'server', 'tools_analysis', 'status_unified', 'status_modes_codex.py')}')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
mod._health = lambda *a, **k: ({'status':'ok'}, '')
mod._omniroute_logs = lambda limit=40: ([
 {'provider':'codex','path':'/v1/responses','requestedModel':'codex/gpt-5.5','sourceFormat':'openai-responses','targetFormat':'openai-responses','status':200},
 {'provider':'codex','path':'/v1/messages','requestedModel':'codex/gpt-5.5-low','sourceFormat':'claude','targetFormat':'openai-responses','status':200},
], '')
print(mod._mode_codex_route())
print('---')
print(mod._mode_hook_decisions())
`;
  const res = spawnSync('python3', ['-c', script], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /verdict=PASS/);
  assert.match(res.stdout, /api=\/api\/usage\/call-logs db=unused/);
  assert.match(res.stdout, /duplicate_systemMessage_stripped=True/);
  assert.doesNotMatch(res.stdout, /storage\.sqlite|\.omniroute/);
  fs.rmSync(root, { recursive: true, force: true });
});
