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
  assert.match(out.body.text, /Read doc\/self-coherence\.md first 12 lines/);
  assert.doesNotMatch(out.body.text, /codex_structured_tool/);
});

test('normalizes internal shell function_call into Bash call', () => {
  const input = { type: 'function_call', name: 'functions.exec_command', arguments: JSON.stringify({ cmd: 'echo hello', justification: 'greet', timeout_ms: 5000, run_in_background: true }) };
  const out = normalizeStructuredBridgeCalls(input);
  assert.strictEqual(out.body.name, 'Bash');
  assert.deepStrictEqual(JSON.parse(out.body.arguments), { command: 'echo hello', timeout: 5000, run_in_background: true, description: 'greet' });
  assert.strictEqual(out.stats.call_rewrites, 1);
  assert.doesNotMatch(JSON.stringify(out.body), /functions\.exec_command|\"cmd\"|justification|timeout_ms/);
});

test('normalizes internal shell tool_use into Bash block', () => {
  const input = { messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'exec_command', input: { cmd: 'git status --short', justification: 'check status' } }] }] };
  const out = normalizeStructuredBridgeCalls(input);
  const block = out.body.messages[0].content[0];
  assert.strictEqual(block.name, 'Bash');
  assert.deepStrictEqual(block.input, { command: 'git status --short', description: 'check status' });
  assert.strictEqual(out.stats.call_rewrites, 1);
  assert.doesNotMatch(JSON.stringify(out.body), /exec_command|\"cmd\"|justification/);
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

test('Codex request transform maps internal shell calls before upstream', () => {
  const result = applyRequestTransform({
    model: 'gpt-5.5',
    input: [{ type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'echo hello', justification: 'greet' }) }],
    tools: [],
  }, {
    loadConfig: () => ({ request_transform: { cleanup: { enabled: true } } }),
    record: () => {},
    projectRoot: process.cwd(),
  });
  assert.strictEqual(result.body.input[0].name, 'Bash');
  assert.deepStrictEqual(JSON.parse(result.body.input[0].arguments), { command: 'echo hello', description: 'greet' });
  assert.strictEqual(result.cleanup.bridge_calls, 1);
  assert.doesNotMatch(JSON.stringify(result.body), /exec_command|\"cmd\"|justification/);
});

test('normalizes broken heredoc Read display text', () => {
  const broken = [
    'Read({"file_path":"<<\'HME_CODEX_JSON\'"})',
    JSON.stringify({ file_path: '$PROJECT_ROOT/tools/HME/service/server/tools_analysis/todo_state_guard.py', offset: 0, limit: 1300 }),
    'HME_CODEX_JSON',
  ].join('\n');
  const out = normalizeStructuredBridgeCalls({ text: broken });
  assert.equal(out.body.text, 'Read tools/HME/service/server/tools_analysis/todo_state_guard.py lines 1-1300');
  assert.doesNotMatch(out.body.text, /HME_CODEX_JSON|<<|\{"file_path":"<</);
});

test('normalizes malformed native Read heredoc input', () => {
  const payload = `<<'HME_CODEX_JSON'\n${JSON.stringify({ file_path: 'doc/self-coherence.md', offset: 25, limit: 10 })}\nHME_CODEX_JSON`;
  const out = normalizeStructuredBridgeCalls({ messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: payload } }] }] });
  assert.deepStrictEqual(out.body.messages[0].content[0].input, { file_path: 'doc/self-coherence.md', offset: 25, limit: 10 });
  assert.doesNotMatch(JSON.stringify(out.body), /HME_CODEX_JSON|<</);
});

test('normalizes edit bridge display without reusable replacement strings', () => {
  const cmd = [
    "node tools/HME/scripts/codex_structured_tool.js edit --json <<'HME_CODEX_JSON'",
    '{"file_path":"src/x.js","old_string":"secret old","new_string":"secret new"}',
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
  assert.match(out.body.text, /Edit src\/x\.js/);
  assert.doesNotMatch(out.body.text, /secret old|secret new|<omitted by proxy>/);
});
