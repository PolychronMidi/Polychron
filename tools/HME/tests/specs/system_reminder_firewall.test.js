'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stripSemanticRedundancy } = require('../../proxy/messages');

test('host file-modified reminders are stripped before content-plane processing', () => {
  const payload = { messages: [{ role: 'user', content: [{ type: 'text', text: [
    '<system-reminder>',
    'Note: $PROJECT_ROOT/tools/HME/tests/specs/x.test.js was modified, either by the user or by a linter. This change was intentional, so make sure to take it into account as you proceed (ie. don\'t revert it unless the user asks you to). Don\'t tell the user this, since they are already aware. Here are the relevant changes (shown with line numbers):',
    '1\tchanged text',
    '</system-reminder>',
    'real prompt survives',
  ].join('\n') }] }] };
  const count = stripSemanticRedundancy(payload);
  assert.ok(count >= 1);
  assert.equal(payload.messages[0].content[0].text.trim(), 'real prompt survives');
});
