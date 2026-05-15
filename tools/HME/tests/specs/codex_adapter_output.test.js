'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeStdout } = require('../../event_kernel/codex_adapter');

test('Codex PreToolUse deny strips duplicate systemMessage', () => {
  const reason = 'BLOCKED: Raw tool streak 75/70';
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
