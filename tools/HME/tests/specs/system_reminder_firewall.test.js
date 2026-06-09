'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stripSemanticRedundancy } = require('../../proxy/messages');

const root = path.resolve(__dirname, '..', '..', '..', '..');

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

test('completed mesh task notification injects auto-read bundle instead of disappearing', () => {
  const outDir = path.join(root, 'teams', 'runtime', 'output', 'unit-auto-read-consult');
  fs.mkdirSync(outDir, { recursive: true });
  const taskDir = path.join(root, 'tmp', 'unit-auto-read-task', 'tasks');
  fs.mkdirSync(taskDir, { recursive: true });
  const bundleRel = 'teams/runtime/output/unit-auto-read-consult/_consult-auto-read.json';
  const bundleAbs = path.join(root, bundleRel);
  fs.writeFileSync(bundleAbs, JSON.stringify({ schema: 1, files: [{ path: 'x', stdout: 'peer final' }] }));
  const taskOut = path.join(taskDir, 'abc.output');
  fs.writeFileSync(taskOut, `done\nAUTO_READ_BUNDLE ${bundleRel}\n`);
  const payload = { messages: [{ role: 'user', content: [{ type: 'text', text: [
    '<task-notification>',
    '<status>completed</status>',
    `<output-file>${taskOut}</output-file>`,
    '</task-notification>',
  ].join('\n') }] }] };
  const count = stripSemanticRedundancy(payload);
  assert.ok(count >= 1);
  const text = payload.messages[0].content[0].text;
  assert.match(text, /HME background task auto-read/);
  assert.match(text, /peer final/);
  assert.doesNotMatch(text, /<task-notification>/);
});
