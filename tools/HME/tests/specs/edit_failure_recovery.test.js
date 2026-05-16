'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const bridge = path.join(repoRoot, 'tools', 'HME', 'scripts', 'codex_structured_tool.js');

function sandbox(prefix = 'hme-edit-failure-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.symlinkSync(path.join(repoRoot, 'tools'), path.join(root, 'tools'));
  return root;
}

function runEdit(root, args) {
  return spawnSync('node', [bridge, 'edit', ...args], {
    cwd: root,
    env: { ...process.env, PROJECT_ROOT: root, HME_SESSION_ID: 'edit-failure-test' },
    encoding: 'utf8',
  });
}

test('no-op Bash after failed tool is blocked until real command clears failure state', () => {
  const root = sandbox('hme-noop-failure-');
  const { evaluateBashInput } = require('../../proxy/bash_command_policy');
  const { recordFailure, readFailure } = require('../../proxy/turn_failure_state');
  try {
    recordFailure(root, { tool: 'Edit', reason: 'old_string not found' });
    const denied = evaluateBashInput({ command: ':' }, { projectRoot: root });
    assert.equal(denied.decision, 'deny');
    assert.match(denied.reason, /no-op command after failed Edit/);
    const real = evaluateBashInput({ command: 'git status --short' }, { projectRoot: root });
    assert.equal(real.decision, 'allow');
    assert.equal(readFailure(root), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('failed structured edit returns current context and does not mark verify-landed edits', () => {
  const root = sandbox();
  const file = path.join(root, 'src', 'target.js');
  fs.writeFileSync(file, ['function demo() {', '  return 1;', '}', ''].join('\n'));
  try {
    const res = runEdit(root, [`file=${file}`, 'old=return 2;', 'new=return 3;']);
    assert.notEqual(res.status, 0);
    assert.match(res.stdout, /old_string not found/);
    assert.match(res.stdout, /\[READ current context src\/target\.js:/);
    assert.match(res.stdout, /return 1/);
    assert.equal(fs.existsSync(path.join(root, 'tmp', 'hme-turn-edits.txt')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('successful structured edit marks verify-landed only after posttool success', () => {
  const root = sandbox();
  const file = path.join(root, 'src', 'target.js');
  fs.writeFileSync(file, 'const value = 1;\n');
  try {
    const res = runEdit(root, [`file=${file}`, 'old=const value = 1;\n', 'new=const value = 2;\n']);
    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.match(res.stdout, /\[SUCCESS\] edit applied/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'const value = 2;\n');
    assert.match(fs.readFileSync(path.join(root, 'tmp', 'hme-turn-edits.txt'), 'utf8'), /^target\n/m);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('structured edit treats already-applied replacement as safe success', () => {
  const root = sandbox();
  const file = path.join(root, 'src', 'target.js');
  fs.writeFileSync(file, 'const value = 2;\n');
  try {
    const res = runEdit(root, [`file=${file}`, 'old=const value = 1;\n', 'new=const value = 2;\n']);
    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.match(res.stdout, /edit already applied/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'const value = 2;\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('malformed structured edit path fails loud instead of empty success', () => {
  const root = sandbox('hme-edit-malformed-path-');
  try {
    const res = runEdit(root, ["file=<<'HME_CODEX_JSON',", 'old=x', 'new=y']);
    const combined = `${res.stdout}${res.stderr}`;
    assert.notEqual(res.status, 0);
    assert.match(combined, /invalid file_path/);
    assert.notEqual(combined.trim(), '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('display-redacted structured edit old_string fails with context', () => {
  const root = sandbox('hme-edit-redacted-old-');
  const file = path.join(root, 'src', 'target.js');
  fs.writeFileSync(file, 'const value = 1;\n');
  try {
    const res = runEdit(root, [`file=${file}`, 'old=<display-redacted: original was sent; do not reuse>', 'new=const value = 2;']);
    assert.notEqual(res.status, 0);
    assert.match(res.stdout, /old_string is display-redacted/);
    assert.match(res.stdout, /\[READ current context src\/target\.js:/);
    assert.match(res.stdout, /const value = 1/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'const value = 1;\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('structured edit safely normalizes trailing whitespace mismatch', () => {
  const root = sandbox('hme-edit-trailing-ws-');
  const file = path.join(root, 'src', 'target.js');
  fs.writeFileSync(file, 'const value = 1;   \n');
  try {
    const res = runEdit(root, [`file=${file}`, 'old=const value = 1;\n', 'new=const value = 2;\n']);
    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.match(res.stdout, /trailing-whitespace-normalized/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'const value = 2;\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('edit failure middleware removes stale verify-landed marker and appends current context', () => {
  const root = sandbox('hme-edit-failure-mw-');
  const file = path.join(root, 'src', 'target.js');
  fs.writeFileSync(file, 'alpha\nbeta current\ngamma\n');
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tmp', 'hme-turn-edits.txt'), 'target\n');
  const mw = require('../../proxy/middleware/29_edit_failure_context');
  const toolResult = { content: 'Error: old_string not found', is_error: true };
  const events = [];
  const warnings = [];
  const ctx = {
    PROJECT_ROOT: root,
    appendToResult(result, text) { result.content = `${result.content || ''}${text}`; },
    markDirty() {},
    warn(message) { warnings.push(message); },
    emit(row) { events.push(row); },
  };
  try {
    mw.onToolResult({
      toolUse: { name: 'Edit', input: { file_path: file, old_string: 'missing', new_string: 'beta current' } },
      toolResult,
      ctx,
    });
    assert.match(toolResult.content, /\[READ current context src\/target\.js:/);
    assert.match(toolResult.content, /beta current/);
    assert.equal(fs.existsSync(path.join(root, 'tmp', 'hme-turn-edits.txt')), false);
    assert.equal(events[0].event, 'edit_failure_context_appended');
    assert.deepEqual(warnings, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
