'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const originalPath = process.env.PATH || '';

function runtimeDir(root) { return path.join(root, 'tmp', 'hme-runtime'); }

function fresh(projectRoot) {
  process.env.PROJECT_ROOT = projectRoot;
  process.env.HME_RUNTIME_DIR = runtimeDir(projectRoot);
  fs.mkdirSync(process.env.HME_RUNTIME_DIR, { recursive: true });
  process.env.PATH = path.join(projectRoot, 'bin') + path.delimiter + originalPath;
  for (const k of Object.keys(require.cache)) {
    if (k.includes('/tools/HME/event_kernel/') || k.includes('/tools/HME/proxy/')) delete require.cache[k];
  }
}

function _withSandbox(prefix = 'codex-hardening-') {
  const base = path.join(os.tmpdir(), 'hme-test-sandboxes');
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, prefix));
  for (const d of ['src', 'tmp', 'log', 'src/output/metrics', '.git', 'bin']) fs.mkdirSync(path.join(root, d), { recursive: true });
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

test('Codex hook decision compact logs hash/channels without raw reason text', () => {
  const root = _withSandbox('codex-decision-');
  const { sanitizeStdout, recordHookDecision } = require('../../event_kernel/codex_adapter');
  const reason = 'BLOCKED: secret reason payload';
  const raw = JSON.stringify({
    hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: reason },
    systemMessage: reason,
  });
  const clean = sanitizeStdout('PreToolUse', raw);
  recordHookDecision(root, 'PreToolUse', raw, clean, { tool_name: 'Bash', session_id: 's1' });
  const log = fs.readFileSync(path.join(runtimeDir(root), 'hook-decisions.jsonl'), 'utf8');
  const row = JSON.parse(log.trim());
  assert.equal(row.duplicate_systemMessage_stripped, true);
  assert.deepEqual(row.surfaced_channels, ['permissionDecisionReason']);
  assert.doesNotMatch(log, /secret reason payload/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Codex PreToolUse payload fixtures route for Read/Grep/Edit/Write', async () => {
  const root = _withSandbox('codex-payloads-');
  const file = path.join(root, 'src', 'fixture.js');
  fs.writeFileSync(file, 'const x = 1;\n');
  const read = await dispatch(root, 'Read', { file_path: file });
  assert.equal(read.exit_code, 0);
  const grep = await dispatch(root, 'Grep', { pattern: 'const', path: path.join(root, 'src'), output_mode: 'files_with_matches' });
  assert.equal(grep.exit_code, 0);
  const edit = await dispatch(root, 'Edit', { file_path: file, old_string: 'const x = 1;\n', new_string: 'const x = 2;\n' });
  assert.equal(edit.exit_code, 0);
  const write = await dispatch(root, 'Write', { file_path: path.join(root, 'src', 'new.js'), content: 'export const y = 1;\n' });
  assert.equal(write.exit_code, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('codex-route and hook-decision status views are compact and API-only', () => {
  const root = _withSandbox('codex-status-');
  fs.mkdirSync(runtimeDir(root), { recursive: true });
  fs.writeFileSync(path.join(runtimeDir(root), 'codex-proxy-events.jsonl'), `${JSON.stringify({ kind: 'request', route: 'omniroute', upstream: 'http://127.0.0.1:20128/v1/responses', after: { model: 'gpt-5.5', tool_names: ['exec_command', 'Read', 'Edit', 'update_plan'] } })}\n${JSON.stringify({ kind: 'response', route: 'omniroute', status: 200, model: 'cx/gpt-5.5' })}\n`);
  fs.writeFileSync(path.join(runtimeDir(root), 'hook-decisions.jsonl'), `${JSON.stringify({ ts: 't', host: 'codex', event: 'PreToolUse', tool: 'Bash', decision: 'deny', reason_hash: 'abc', surfaced_channels: ['permissionDecisionReason'], duplicate_systemMessage_stripped: true })}\n`);
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
  assert.match(res.stdout, /codex native Read\/Edit: present/);
  assert.match(res.stdout, /Hook decision compact/);
  assert.doesNotMatch(res.stdout, /storage\.sqlite|\.omniroute/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Codex structured read/edit shims route synthetic native events', () => {
  const root = _withSandbox('codex-structured-shim-');
  const file = path.join(root, 'src', 'shim.js');
  fs.writeFileSync(file, 'const x = 1;\n');
  const env = {
    ...process.env,
    PROJECT_ROOT: root,
    HME_SESSION_ID: 'shim-read',
    PATH: path.join(root, 'bin') + path.delimiter + originalPath,
  };
  const read = spawnSync('node', [path.join(repoRoot, 'tools', 'HME', 'scripts', 'codex_structured_tool.js'), 'read', `file=${file}`, 'limit=5'], { env, encoding: 'utf8' });
  assert.equal(read.status, 0, read.stderr);
  assert.match(read.stdout, /const x = 1/);
  const editEnv = { ...env, HME_SESSION_ID: 'shim-edit' };
  const edit = spawnSync('node', [
    path.join(repoRoot, 'tools', 'HME', 'scripts', 'codex_structured_tool.js'), 'edit',
    `file=${file}`,
    'old=const x = 1;\n',
    'new=const x = 2;\n',
  ], { env: editEnv, encoding: 'utf8' });
  assert.equal(edit.status, 0, edit.stderr);
  assert.match(edit.stdout, /edit applied/);
  assert.doesNotMatch(edit.stdout, /central pre-write check passed/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'const x = 2;\n');
  const nexus = fs.readFileSync(path.join(root, 'tmp', 'hme-nexus.state'), 'utf8');
  assert.match(nexus, /EDIT:/);
  assert.equal(fs.existsSync(path.join(repoRoot, 'i', 'read')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'i', 'edit')), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Codex structured git marks empty success explicitly', () => {
  const root = _withSandbox('codex-structured-git-');
  const env = {
    ...process.env,
    PROJECT_ROOT: root,
    HME_SESSION_ID: 'shim-git',
    PATH: path.join(root, 'bin') + path.delimiter + originalPath,
  };
  const res = spawnSync('node', [
    path.join(repoRoot, 'tools', 'HME', 'scripts', 'codex_structured_tool.js'), 'git', '--json',
  ], { env, input: JSON.stringify({ args: ['status', '--short'] }), encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /\[SUCCESS\]/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Codex Bash hook treats internal structured bridge as structured exit', async () => {
  const root = _withSandbox('codex-structured-bash-');
  const { dispatchEvent } = require('../../event_kernel/dispatcher');
  const res = await dispatchEvent('PreToolUse', JSON.stringify({
    cwd: root,
    _hme_host: 'codex',
    tool_name: 'Bash',
    tool_input: { command: 'node tools/HME/scripts/codex_structured_tool.js edit file=src/x.js old=a new=b' },
    session_id: 'codex-Bash',
  }));
  assert.equal(res.exit_code, 0);
  fs.rmSync(root, { recursive: true, force: true });
});
