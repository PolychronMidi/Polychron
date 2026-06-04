'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Render = require('./decision_renderer');

test('decision renderer emits host event names for permission-style decisions', () => {
  const pre = JSON.parse(Render.renderDeny('PreToolUse', 'no'));
  assert.deepEqual(pre.hookSpecificOutput, {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: 'no',
  });
  const pr = JSON.parse(Render.renderDeny('PermissionRequest', 'no'));
  assert.equal(pr.hookSpecificOutput.hookEventName, 'PermissionRequest');
  assert.equal(pr.hookSpecificOutput.permissionDecision, 'deny');
});
