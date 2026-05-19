'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { toolResultInput, collectSseToolCalls, EMPTY_BASH_TOOL_RESULT: codexNotice } = require('../../proxy/codex_tool_loop');
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
