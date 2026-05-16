'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normalizeStructuredBridgeCalls, bridgeCommand } = require('../../proxy/codex_tool_text');
const { applyRequestTransform } = require('../../proxy/codex_payload');

const CMD = 'node tools/HME/scripts/codex_structured_tool.js read file=doc/self-coherence.md limit=12';

test('normalizes internal bridge function_call into native-looking Read call', () => {
  const input = { type: 'function_call', name: 'functions.exec_command', arguments: JSON.stringify({ cmd: CMD }) };
  const out = normalizeStructuredBridgeCalls(input);
  assert.strictEqual(out.body.name, 'Read');
  assert.deepStrictEqual(JSON.parse(out.body.arguments), { file_path: 'doc/self-coherence.md', limit: 12 });
  assert.strictEqual(out.stats.call_rewrites, 1);
  assert.doesNotMatch(JSON.stringify(out.body), /codex_structured_tool/);
});

test('normalizes internal bridge text lines into native-looking display', () => {
  const out = normalizeStructuredBridgeCalls({ text: `before\n${CMD}\nafter` });
  assert.match(out.body.text, /Read\(\{"file_path":"doc\/self-coherence.md","limit":12\}\)/);
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
  assert.deepStrictEqual(JSON.parse(result.body.input[0].arguments), { file_path: 'doc/self-coherence.md', limit: 12 });
  assert.strictEqual(result.cleanup.bridge_calls, 1);
  assert.doesNotMatch(JSON.stringify(result.body), /codex_structured_tool/);
});


test('normalizes Edit bridge calls without pretending old_string was omitted', () => {
  const cmd = [
    "node tools/HME/scripts/codex_structured_tool.js edit --json <<'HME_CODEX_JSON'",
    JSON.stringify({ file_path: 'src/target.js', old_string: 'secret old text', new_string: 'secret new text' }),
    'HME_CODEX_JSON',
  ].join('\n');
  const out = normalizeStructuredBridgeCalls({ text: cmd });
  assert.match(out.body.text, /Edit\(/);
  assert.match(out.body.text, /display-redacted: original was sent; do not reuse/);
  assert.doesNotMatch(out.body.text, /secret old text|secret new text|omitted by proxy/);
});


test('normalizes edit bridge display without implying old_string was omitted', () => {
  const cmd = [
    "node tools/HME/scripts/codex_structured_tool.js edit --json <<'HME_CODEX_JSON'",
    JSON.stringify({ file_path: 'src/target.js', old_string: 'secret old', new_string: 'secret new' }),
    'HME_CODEX_JSON',
  ].join('\n');
  const out = normalizeStructuredBridgeCalls({ text: cmd });
  assert.match(out.body.text, /Edit\(/);
  assert.match(out.body.text, /display-redacted: original was sent; do not reuse/);
  assert.doesNotMatch(out.body.text, /secret old|secret new|omitted by proxy/);
});


test('normalizes edit bridge as display-redacted, not omitted literal text', () => {
  const cmd = [
    "node tools/HME/scripts/codex_structured_tool.js edit --json <<'HME_CODEX_JSON'",
    JSON.stringify({ file_path: 'src/x.js', old_string: 'secret old', new_string: 'secret new' }),
    'HME_CODEX_JSON',
  ].join('\n');
  const out = normalizeStructuredBridgeCalls({ text: cmd });
  assert.match(out.body.text, /Edit\(\{/);
  assert.match(out.body.text, /display-redacted: original was sent; do not reuse/);
  assert.doesNotMatch(out.body.text, /secret old|secret new|omitted by proxy/);
});


test('edit bridge display marks redaction as display-only', () => {
  const cmd = [
    "node tools/HME/scripts/codex_structured_tool.js edit --json <<'HME_CODEX_JSON'",
    JSON.stringify({ file_path: 'src/x.js', old_string: 'secret old', new_string: 'secret new' }),
    'HME_CODEX_JSON',
  ].join('\n');
  const out = normalizeStructuredBridgeCalls({ text: cmd });
  assert.match(out.body.text, /Edit\(\{"file_path":"src\/x\.js"/);
  assert.match(out.body.text, /display-redacted: original was sent; do not reuse/);
  assert.doesNotMatch(out.body.text, /secret old|secret new|omitted by proxy/);
});


test('edit bridge display makes redaction explicit and non-reusable', () => {
  const cmd = [
    "node tools/HME/scripts/codex_structured_tool.js edit --json <<'HME_CODEX_JSON'",
    JSON.stringify({ file_path: 'src/target.js', old_string: 'secret old', new_string: 'secret new' }),
    'HME_CODEX_JSON',
  ].join('\n');
  const out = normalizeStructuredBridgeCalls({ text: cmd });
  assert.match(out.body.text, /Edit\(/);
  assert.match(out.body.text, /display-redacted: original was sent; do not reuse/);
  assert.doesNotMatch(out.body.text, /secret old|secret new|omitted by proxy/);
});


test('normalizes Edit bridge display without reusable replacement strings', () => {
  const cmd = [
    "node tools/HME/scripts/codex_structured_tool.js edit --json <<'HME_CODEX_JSON'",
    JSON.stringify({ file_path: 'src/x.js', old_string: 'secret old', new_string: 'secret new' }),
    'HME_CODEX_JSON',
  ].join('\n');
  const bridge = bridgeCommand(cmd);
  assert.strictEqual(bridge.tool, 'Edit');
  assert.deepStrictEqual(bridge.input, {
    file_path: 'src/x.js',
    old_string: '<display-redacted: original was sent; do not reuse>',
    new_string: '<display-redacted: original was sent; do not reuse>',
  });
  const out = normalizeStructuredBridgeCalls({ text: cmd });
  assert.match(out.body.text, /Edit\(/);
  assert.doesNotMatch(out.body.text, /secret old|secret new|<omitted by proxy>/);
});


test('normalizes edit bridge displays with non-reusable redaction sentinel', () => {
  const cmd = [
    "node tools/HME/scripts/codex_structured_tool.js edit --json <<'HME_CODEX_JSON'",
    JSON.stringify({ file_path: 'src/x.js', old_string: 'secret old', new_string: 'secret new' }),
    'HME_CODEX_JSON',
  ].join('\n');
  const bridge = bridgeCommand(cmd);
  assert.strictEqual(bridge.tool, 'Edit');
  assert.strictEqual(bridge.input.file_path, 'src/x.js');
  assert.match(bridge.input.old_string, /display-redacted/);
  assert.doesNotMatch(JSON.stringify(bridge.input), /secret old|secret new|omitted by proxy/);
  const out = normalizeStructuredBridgeCalls({ text: cmd });
  assert.match(out.body.text, /Edit\(/);
  assert.doesNotMatch(out.body.text, /codex_structured_tool|secret old|<omitted by proxy>/);
});
