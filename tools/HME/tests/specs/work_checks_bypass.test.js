'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { withChainSandbox } = require('../chain_sandbox');

function buildTranscript(entries) {
  return entries.map((e) => JSON.stringify(e)).join('\n');
}

test('isBareCompletionMarker matches all the canonical bypass shapes', () => withChainSandbox('wc-bypass-bare-', () => {
  const { _testables } = require('../../proxy/stop_chain/policies/work_checks');
  const fn = _testables.isBareCompletionMarker;
  for (const shape of ['[SUCCESS]', '[ok]', 'OK', 'OK.', 'done', 'Done.', 'noted', 'k', 'K.', '✓', 'fp-gate marker', 'continue']) {
    assert.equal(fn(shape), true, `${shape} should be a bypass marker`);
  }
}));

test('isBareCompletionMarker rejects sentences and long text', () => withChainSandbox('wc-bypass-long-', () => {
  const { _testables } = require('../../proxy/stop_chain/policies/work_checks');
  const fn = _testables.isBareCompletionMarker;
  assert.equal(fn('Done -- migrated three call sites.'), false);
  assert.equal(fn('Implemented the feature.'), false);
  assert.equal(fn('OK. Tree is clean and the verifier passes.'), false);
  assert.equal(fn(''), false);
  assert.equal(fn(null), false);
}));

test('assistantToolUsesSinceLastUserPrompt counts only post-user-prompt tool calls', () => withChainSandbox('wc-bypass-tools-', () => {
  const { _testables } = require('../../proxy/stop_chain/policies/work_checks');
  const fn = _testables.assistantToolUsesSinceLastUserPrompt;
  const file = path.join(os.tmpdir(), 'wc-bypass-transcript-' + Date.now() + '.jsonl');
  const transcript = buildTranscript([
    { type: 'user', message: { content: 'first ask' } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash' }] } },
    { type: 'user', message: { content: 'second ask' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: '[SUCCESS]' }] } },
  ]);
  fs.writeFileSync(file, transcript);
  try {
    assert.equal(fn(file), 0, 'second turn has no tool calls');
  } finally {
    fs.rmSync(file, { force: true });
  }
}));

test('assistantToolUsesSinceLastUserPrompt counts tool calls since the latest real user prompt', () => withChainSandbox('wc-bypass-counted-', () => {
  const { _testables } = require('../../proxy/stop_chain/policies/work_checks');
  const fn = _testables.assistantToolUsesSinceLastUserPrompt;
  const file = path.join(os.tmpdir(), 'wc-bypass-transcript2-' + Date.now() + '.jsonl');
  const transcript = buildTranscript([
    { type: 'user', message: { content: 'old ask' } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't0', name: 'Bash' }] } },
    { type: 'user', message: { content: 'new ask' } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Edit' }, { type: 'tool_use', id: 't2', name: 'Bash' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } },
  ]);
  fs.writeFileSync(file, transcript);
  try {
    assert.equal(fn(file), 2, 'two tool calls since latest user');
  } finally {
    fs.rmSync(file, { force: true });
  }
}));

test('system-notification user entries do not reset the count', () => withChainSandbox('wc-bypass-sysnote-', () => {
  const { _testables } = require('../../proxy/stop_chain/policies/work_checks');
  const fn = _testables.assistantToolUsesSinceLastUserPrompt;
  const file = path.join(os.tmpdir(), 'wc-bypass-transcript3-' + Date.now() + '.jsonl');
  const transcript = buildTranscript([
    { type: 'user', message: { content: 'real user prompt' } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash' }] } },
    { type: 'user', message: { content: '[SYSTEM NOTIFICATION] background task completed' } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Edit' }] } },
  ]);
  fs.writeFileSync(file, transcript);
  try {
    assert.equal(fn(file), 2, 'system notification should not anchor the lookback');
  } finally {
    fs.rmSync(file, { force: true });
  }
}));
