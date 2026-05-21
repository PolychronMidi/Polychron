'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { canonicalToolSchemas, canonicalToolMetadata, canonicalLangChainTools, missingRequiredFields, requiresApproval } = require('../../proxy/hme_tool_registry');
const { bridgePlan, toolNames, toolSurface } = require('../../proxy/universal_tool_surface');

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

test('smolagents registry exports LangChain StructuredTool-compatible descriptors from same source', () => {
  const schemas = canonicalToolSchemas();
  const langchain = canonicalLangChainTools();
  assert.deepEqual(langchain.map((tool) => tool.name), schemas.map((tool) => tool.name));
  const read = langchain.find((tool) => tool.name === 'Read');
  assert.ok(read);
  assert.equal(read.args_schema.type, 'object');
  assert.equal(read.args_schema.additionalProperties, false);
  assert.equal(read.args_schema.properties.file_path.type, 'string');
  assert.equal(read.metadata.side_effect, 'read');
  assert.equal(read.metadata.bridge_action, 'read');
  assert.equal(read.metadata.host_native, false);
  assert.equal(read.return_direct, false);
  const edit = langchain.find((tool) => tool.name === 'Edit');
  assert.equal(edit.metadata.policy.requires_prior_read, true);
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
  assert.deepEqual(
    canonicalToolSchemas(),
    snapshot,
    'Codex HME tool schema drifted. If intentional, regenerate with: python3 tools/HME/hme_tools/export.py --kind codex --output tools/HME/tests/fixtures/hme-tools-codex.snapshot.json && python3 -m json.tool tools/HME/tests/fixtures/hme-tools-codex.snapshot.json > tmp/hme-tools-codex.pretty && mv tmp/hme-tools-codex.pretty tools/HME/tests/fixtures/hme-tools-codex.snapshot.json',
  );
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
  assert.equal(requiresApproval('Bash', { cmd: 'rm tmp/example' }), true);
  assert.equal(requiresApproval('Bash', { command: 'printf safe' }), false);
  assert.equal(requiresApproval('Edit', { file_path: 'x', old_string: 'a', new_string: 'b' }), true);
});
