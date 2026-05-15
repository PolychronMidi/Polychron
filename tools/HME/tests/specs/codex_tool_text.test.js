'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normalizeStructuredBridgeCalls } = require('../../proxy/codex_tool_text');
const { applyRequestTransform } = require('../../proxy/codex_payload');

const CMD = 'node tools/HME/scripts/codex_structured_tool.js read file=doc/HME.md limit=12';

test('normalizes internal bridge function_call into native-looking Read call', () => {
  const input = { type: 'function_call', name: 'functions.exec_command', arguments: JSON.stringify({ cmd: CMD }) };
  const out = normalizeStructuredBridgeCalls(input);
  assert.strictEqual(out.body.name, 'Read');
  assert.deepStrictEqual(JSON.parse(out.body.arguments), { file_path: 'doc/HME.md', limit: 12 });
  assert.strictEqual(out.stats.call_rewrites, 1);
  assert.doesNotMatch(JSON.stringify(out.body), /codex_structured_tool/);
});

test('normalizes internal bridge text lines into native-looking display', () => {
  const out = normalizeStructuredBridgeCalls({ text: `before\n${CMD}\nafter` });
  assert.match(out.body.text, /Read\(\{"file_path":"doc\/HME.md","limit":12\}\)/);
  assert.doesNotMatch(out.body.text, /codex_structured_tool/);
});

test('Codex request transform hides bridge script calls before upstream', () => {
  const result = applyRequestTransform({
    model: 'gpt-5.5',
    input: [{ type: 'function_call', name: 'functions.exec_command', arguments: JSON.stringify({ cmd: CMD }) }],
    tools: [],
  }, {
    loadConfig: () => ({ request_transform: { cleanup: { enabled: true } } }),
    record: () => {},
    projectRoot: process.cwd(),
  });
  assert.strictEqual(result.body.input[0].name, 'Read');
  assert.deepStrictEqual(JSON.parse(result.body.input[0].arguments), { file_path: 'doc/HME.md', limit: 12 });
  assert.strictEqual(result.cleanup.bridge_calls, 1);
  assert.doesNotMatch(JSON.stringify(result.body), /codex_structured_tool/);
});
