'use strict';
const assert = require('node:assert');
const { test } = require('node:test');

const rc = require('../../proxy/read_chain');
const cfg = require('../../proxy/shortcuts_config');
const rewriter = require('../../proxy/middleware/00a_shortcuts_rewriter');

test('rr shortcut expands (wire lane) into the read-chain trigger', () => {
  assert.equal(cfg.SHORTCUTS.rr, '[HME_READ_CHAIN] README.md; package.json');
  const body = { messages: [{ role: 'user', content: [{ type: 'text', text: 'rr' }] }] };
  rewriter.onRequest({ payload: body, ctx: {} });
  assert.equal(body.messages[0].content[0].text, '[HME_READ_CHAIN] README.md; package.json');
});

test('trigger parses the file queue from the last user message', () => {
  const body = { messages: [{ role: 'user', content: [{ type: 'text', text: '[HME_READ_CHAIN] /a/one.json; /a/two.json' }] }] };
  assert.deepEqual(rc.startFilesFromTrigger(body), ['/a/one.json', '/a/two.json']);
  assert.equal(rc.startFilesFromTrigger({ messages: [{ role: 'user', content: 'hello' }] }), null);
});

test('first emit is a real Read tool_use whose id round-trips the queue', () => {
  const files = ['/a/one.json', '/a/two.json'];
  const msg = rc.buildReadToolUseMessage(files, 0, { model: 'm' });
  assert.equal(msg.stop_reason, 'tool_use');
  const use = msg.content.find((b) => b.type === 'tool_use');
  assert.equal(use.name, 'Read');
  assert.equal(use.input.file_path, '/a/one.json');
  assert.deepEqual(rc._parseToolId(use.id), { index: 0, files });
});

test('a tool_result echoing our id drives the NEXT read with no model decision', () => {
  const files = ['/a/one.json', '/a/two.json'];
  const id0 = rc._toolId(0, files);
  const payload = { messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: id0, content: '<bytes>' }] }] };
  const step = rc.nextStepFromToolResult(payload);
  assert.deepEqual(step, { nextIndex: 1, files });
  const use = rc.buildReadToolUseMessage(step.files, step.nextIndex, { model: 'm' }).content.find((b) => b.type === 'tool_use');
  assert.equal(use.input.file_path, '/a/two.json');
});

test('queue exhaustion yields done, not another read', () => {
  const files = ['/a/one.json', '/a/two.json'];
  const id1 = rc._toolId(1, files);
  const payload = { messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: id1, content: '<bytes>' }] }] };
  const step = rc.nextStepFromToolResult(payload);
  assert.equal(step.nextIndex, 2);
  assert.equal(rc.buildReadToolUseMessage(step.files, step.nextIndex, { model: 'm' }), null);
  const done = rc.buildDoneMessage(files.length, { model: 'm' });
  assert.equal(done.stop_reason, 'end_turn');
  assert.match(done.content[0].text, /done: 2 file/);
});

test('non-read-chain tool_result is ignored (no false drive)', () => {
  const payload = { messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_normal', content: 'x' }] }] };
  assert.equal(rc.nextStepFromToolResult(payload), null);
});
