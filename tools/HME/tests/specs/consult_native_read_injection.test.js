'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { injectConsultNativeReadResults } = require('../../proxy/hme_proxy_request_mutation');

const root = path.resolve(__dirname, '..', '..', '..', '..');

test('completed task notification injects provider-agnostic native Read tool_use/tool_result pairs', () => {
  const outDir = path.join(root, 'teams', 'runtime', 'output', 'unit-native-read-consult');
  fs.mkdirSync(outDir, { recursive: true });
  const fileRel = 'teams/runtime/output/unit-native-read-consult/red_final.json';
  fs.writeFileSync(path.join(root, fileRel), JSON.stringify({ reply: 'red evidence' }));
  const marker = path.join(root, 'tools', 'HME', 'runtime', 'latest-consult-read-queue.json');
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, JSON.stringify({
    schema: 1,
    round: 'unit-native-read-consult',
    native_read_before_report: [fileRel],
    expires_at: new Date(Date.now() + 60000).toISOString(),
    consumed: false,
  }));
  const payload = { messages: [{ role: 'user', content: [{ type: 'text', text: '<task-notification>\n<status>completed</status>\n</task-notification>' }] }] };
  const n = injectConsultNativeReadResults(payload);
  assert.equal(n, 1);
  assert.equal(payload.messages.length, 3);
  assert.equal(payload.messages[0].role, 'assistant');
  assert.equal(payload.messages[0].content[0].type, 'tool_use');
  assert.equal(payload.messages[0].content[0].name, 'Read');
  assert.equal(payload.messages[1].role, 'user');
  assert.equal(payload.messages[1].content[0].type, 'tool_result');
  assert.match(payload.messages[1].content[0].content, /red evidence/);
  assert.equal(JSON.parse(fs.readFileSync(marker, 'utf8')).consumed, true);
});
