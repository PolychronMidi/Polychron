'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { toolResultInput, collectSseToolCalls, followupBody, EMPTY_BASH_TOOL_RESULT: codexNotice } = require('../../proxy/codex_tool_loop');
const { EMPTY_BASH_TOOL_RESULT: omniNotice } = require('../../proxy/omni_tool_loop');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

test('Codex tool loop marks empty Bash calls as adapter notice, not recovered task context', () => {
  const results = toolResultInput([
    { id: 'call_empty_bash', name: 'Bash', args: { command: '' } },
  ], { projectRoot: repoRoot });

  assert.equal(results.length, 1);
  assert.equal(results[0].type, 'function_call_output');
  assert.equal(results[0].call_id, 'call_empty_bash');
  assert.equal(results[0].output, codexNotice);
  assert.match(results[0].output, /not task context/);
  assert.match(results[0].output, /Continue from the latest user request/);
  assert.doesNotMatch(results[0].output, /^Error: command is required/m);
});

test('Anthropic omni loop uses same empty Bash adapter notice', () => {
  assert.equal(omniNotice, codexNotice);
  assert.match(omniNotice, /ignored an empty Bash tool call/);
  assert.doesNotMatch(omniNotice, /^Error: command is required/m);
});

test('Codex SSE collector merges function-call argument deltas before incomplete filtering', () => {
  const lines = [
    { type: 'response.output_item.added', item: { type: 'function_call', name: 'Read', call_id: 'call_read_delta' } },
    { type: 'response.function_call_arguments.delta', call_id: 'call_read_delta', delta: '{"file_path":"README.md"' },
    { type: 'response.function_call_arguments.delta', call_id: 'call_read_delta', delta: ',"offset":0,"limit":20}' },
    { type: 'response.function_call_arguments.done', call_id: 'call_read_delta', arguments: '{"file_path":"README.md","offset":0,"limit":20}' },
  ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');

  const calls = collectSseToolCalls(lines);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    id: 'call_read_delta',
    name: 'Read',
    args: { file_path: 'README.md', offset: 0, limit: 20 },
  });
});
