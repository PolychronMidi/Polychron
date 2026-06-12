'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..', '..');
if (!process.env.PROJECT_ROOT) process.env.PROJECT_ROOT = root;
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

test('completed mesh task notification injects auto-read bundle instead of disappearing', () => {
  const outDir = path.join(root, 'teams', 'runtime', 'output', 'unit-auto-read-consult');
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'tools', 'HME', 'runtime'), { recursive: true });
  const latestPath = path.join(root, 'tools', 'HME', 'runtime', 'latest-consult-read-queue.json');
  fs.writeFileSync(latestPath, JSON.stringify({
    schema: 2,
    native_read_before_report: ['teams/runtime/output/unit-auto-read-consult/red_final.json'],
    generated_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60000).toISOString(),
    consumed: false,
  }));
  const payload = { messages: [{ role: 'user', content: [{ type: 'text', text: [
    '<task-notification>',
    '<status>completed</status>',
    '<summary>Background command "Rerun hypermeta consult" completed (exit code 0)</summary>',
    '</task-notification>',
  ].join('\n') }] }] };
  const count = stripSemanticRedundancy(payload);
  assert.ok(count >= 1);
  const text = payload.messages[0].content[0].text;
  assert.match(text, /HME consult native-read queue/);
  assert.match(text, /red_final\.json/);
  assert.doesNotMatch(text, /<task-notification>/);
  assert.equal(JSON.parse(fs.readFileSync(latestPath, 'utf8')).consumed, true);

  const payload2 = { messages: [{ role: 'user', content: [{ type: 'text', text: '<task-notification>\n<status>completed</status>\n</task-notification>' }] }] };
  stripSemanticRedundancy(payload2);
  assert.equal(payload2.messages[0].content[0].text.trim(), '(content stripped by hme-proxy boilerplate filter)');
});
