'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { canonicalToolSchemas, canonicalToolMetadata, missingRequiredFields, requiresApproval } = require('../../proxy/hme_tool_registry');

const ROOT = path.resolve(__dirname, '../../..', '..');

test('smolagents HME registry exports bare native-looking tool names', () => {
  const schemas = canonicalToolSchemas();
  assert.deepEqual(schemas.map((tool) => tool.name), ['Agent', 'Bash', 'Edit', 'Read', 'WebFetch', 'WebSearch', 'Write']);
  for (const tool of schemas) {
    assert.equal(tool.type, 'function');
    assert.equal(tool.name.startsWith('hme_'), false);
    assert.equal(tool.parameters.type, 'object');
    assert.equal(tool.parameters.additionalProperties, false);
  }
});

test('smolagents HME registry preserves policy metadata separately from model schema', () => {
  const meta = canonicalToolMetadata();
  const byName = Object.fromEntries(meta.map((tool) => [tool.name, tool]));
  assert.equal(byName.Read.hme.side_effect, 'read');
  assert.equal(byName.Bash.hme.approval, 'destructive');
  assert.equal(byName.Edit.hme.approval, 'always');
  assert.equal(byName.Write.hme.approval, 'always');
  assert.equal(byName.Read.parameters.required.includes('file_path'), true);
  assert.equal(byName.Bash.parameters.required.includes('command'), true);
});

test('smolagents HME tool runner executes bare Bash tool name', () => {
  const script = path.join(ROOT, 'tools/HME/hme_tools/run_tool.py');
  const result = spawnSync('python3', [script, 'Bash', '--json'], {
    cwd: ROOT,
    input: JSON.stringify({ command: 'printf smolagents-bare-tool' }),
    encoding: 'utf8',
    env: { ...process.env, PROJECT_ROOT: ROOT, HME_SOURCE_ROOT: ROOT },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'smolagents-bare-tool');
});

test('smolagents exported schema matches checked Codex snapshot', () => {
  const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/HME/tests/fixtures/hme-tools-codex.snapshot.json'), 'utf8'));
  assert.deepEqual(canonicalToolSchemas(), snapshot);
});

test('smolagents validation exposes required-field aliases and approval policy', () => {
  assert.deepEqual(missingRequiredFields('Read', { file: 'README.md' }), []);
  assert.deepEqual(missingRequiredFields('Read', {}), ['file_path']);
  const script = path.join(ROOT, 'tools/HME/hme_tools/validate_tool.py');
  const result = spawnSync('python3', [script, 'Bash', '--json'], {
    cwd: ROOT,
    input: JSON.stringify({ cmd: 'rm tmp/example' }),
    encoding: 'utf8',
    env: { ...process.env, PROJECT_ROOT: ROOT, HME_SOURCE_ROOT: ROOT },
  });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.requires_approval, true);
});
