'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeStdout } = require('../../event_kernel/codex_adapter');

test('Codex PreToolUse deny strips duplicate systemMessage', () => {
  const reason = 'BLOCKED: synthetic duplicate reason';
  const out = sanitizeStdout('PreToolUse', JSON.stringify({
    hookSpecificOutput: {
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
    systemMessage: reason,
  }));
  const parsed = JSON.parse(out);
  assert.equal(parsed.hookSpecificOutput.permissionDecisionReason, reason);
  assert.equal(Object.hasOwn(parsed, 'systemMessage'), false);
});

test('Codex UserPromptSubmit strips allow diagnostics from lifecycle JSON', () => {
  const out = sanitizeStdout('UserPromptSubmit', JSON.stringify({
    hookSpecificOutput: { additionalContext: 'lifesaver context' },
    decision: 'allow',
    reason: 'diagnostic only',
  }));
  assert.deepEqual(JSON.parse(out), {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: 'lifesaver context',
    },
  });
});

test('Codex UserPromptSubmit merges concatenated lifecycle JSON objects', () => {
  const raw = [
    JSON.stringify({ hookSpecificOutput: { additionalContext: 'first' }, decision: 'allow', reason: 'r1' }),
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'second' } }),
  ].join('\n');
  const parsed = JSON.parse(sanitizeStdout('UserPromptSubmit', raw));
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.equal(parsed.hookSpecificOutput.additionalContext, 'first\n\nsecond');
  assert.equal(Object.hasOwn(parsed, 'decision'), false);
  assert.equal(Object.hasOwn(parsed, 'reason'), false);
});

test('Codex UserPromptSubmit preserves block while keeping one JSON object', () => {
  const out = sanitizeStdout('UserPromptSubmit', JSON.stringify({
    hookSpecificOutput: { additionalContext: 'stop here' },
    decision: 'block',
    reason: 'blocked by policy',
  }));
  const parsed = JSON.parse(out);
  assert.equal(parsed.decision, 'block');
  assert.equal(parsed.reason, 'blocked by policy');
  assert.equal(parsed.hookSpecificOutput.additionalContext, 'stop here');
});
