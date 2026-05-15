'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normalizeICommand, normalizeICommandsInValue } = require('../../proxy/i_command_text');
const { normalizeICommands } = require('../../proxy/messages');
const { applyRequestTransform } = require('../../proxy/codex_payload');

const ABS = '/home/jah/Polychron/i/status mode=health';

test('normalizes i wrapper path variants to canonical command text', () => {
  assert.strictEqual(normalizeICommand(ABS), 'i/status mode=health');
  assert.strictEqual(normalizeICommand('./i/review -- mode=forget'), 'i/review mode=forget');
  assert.strictEqual(normalizeICommand('cd tools/HME && ../../i/status mode=health'), 'i/status mode=health');
  assert.strictEqual(normalizeICommand('node scripts/hme-i-dispatch.js status mode=health'), 'i/status mode=health');
});

test('normalizes structured command fields without touching prose', () => {
  const stats = { command_rewrites: 0, text_rewrites: 0 };
  const out = normalizeICommandsInValue({ command: ABS, text: `User said ${ABS}` }, stats);
  assert.strictEqual(out.command, 'i/status mode=health');
  assert.match(out.text, /User said \/home\/jah\/Polychron\/i\/status/);
  assert.deepStrictEqual(stats, { command_rewrites: 1, text_rewrites: 0 });
});

test('Claude message normalizer rewrites Bash tool_use command in-place', () => {
  const payload = { messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: ABS } }] }] };
  assert.strictEqual(normalizeICommands(payload), 1);
  assert.strictEqual(payload.messages[0].content[0].input.command, 'i/status mode=health');
});

test('Codex request transform rewrites i wrapper commands before upstream', () => {
  const result = applyRequestTransform({
    model: 'gpt-5.5',
    input: [{ type: 'function_call', name: 'functions.exec_command', arguments: JSON.stringify({ cmd: ABS }) }],
    tools: [],
  }, {
    loadConfig: () => ({ request_transform: { cleanup: { enabled: true } } }),
    record: () => {},
    projectRoot: process.cwd(),
  });
  assert.strictEqual(JSON.parse(result.body.input[0].arguments).cmd, 'i/status mode=health');
  assert.strictEqual(result.cleanup.i_commands, 1);
  assert.doesNotMatch(JSON.stringify(result.body), /\/home\/jah\/Polychron\/i\/status/);
});
