// CONVENTIONS: see ../../proxy/CONVENTIONS.md — import from source files,
// never from barrel index.js re-exports.
//
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { sanitizeMessages } = require('../../proxy/conversation_graph');
const { stripBoilerplate } = require('../../proxy/messages');

function contentText(msg) {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content.map((b) => (b && b.type === 'text' ? b.text : '')).join('');
  }
  return '';
}

test('sanitizeMessages backfills an empty role:"system" string message (the upstream-400 repro)', () => {
  const payload = { messages: [
    { role: 'user', content: 'hi' },
    { role: 'system', content: '' },
    { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
  ] };
  const changed = sanitizeMessages(payload);
  const sys = payload.messages[1];
  assert.ok(changed >= 1, 'should report a change');
  assert.notStrictEqual(sys.content, '', 'empty system content must be backfilled');
  assert.ok(contentText(sys).trim().length > 0, 'backfilled content must be non-empty');
});

test('sanitizeMessages backfills empty-string user and assistant messages', () => {
  for (const role of ['user', 'assistant']) {
    const payload = { messages: [{ role, content: '   ' }] };
    sanitizeMessages(payload);
    assert.ok(contentText(payload.messages[0]).trim().length > 0, `${role} empty string backfilled`);
  }
});

test('sanitizeMessages backfills null / malformed content', () => {
  const payload = { messages: [
    { role: 'system', content: null },
    { role: 'user', content: undefined },
  ] };
  sanitizeMessages(payload);
  assert.ok(contentText(payload.messages[0]).trim().length > 0, 'null backfilled');
  assert.ok(contentText(payload.messages[1]).trim().length > 0, 'undefined backfilled');
});

test('sanitizeMessages leaves non-empty string content untouched (cache safety)', () => {
  const payload = { messages: [{ role: 'system', content: 'real system note' }] };
  const changed = sanitizeMessages(payload);
  assert.strictEqual(changed, 0, 'no change for non-empty content');
  assert.strictEqual(payload.messages[0].content, 'real system note');
});

test('sanitizeMessages does not clobber a signed thinking-only assistant message', () => {
  const payload = { messages: [
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'reasoning...', signature: 'sig123' }] },
  ] };
  sanitizeMessages(payload);
  const blocks = payload.messages[0].content;
  assert.ok(Array.isArray(blocks) && blocks.length === 1, 'thinking block preserved');
  assert.strictEqual(blocks[0].type, 'thinking');
});

test('stripBoilerplate guard backfills an empty role:"system" message anywhere in history', () => {
  // Pad past the recent block-strip window so the empty message sits OUTSIDE it;
  // the non-empty guard must still run over the whole message array.
  const messages = [];
  for (let i = 0; i < 12; i++) messages.push({ role: 'user', content: `msg ${i}` });
  messages.splice(2, 0, { role: 'system', content: '' });
  const payload = { messages };
  const fixed = stripBoilerplate(payload);
  assert.ok(contentText(payload.messages[2]).trim().length > 0, 'empty system content backfilled');
  assert.ok(fixed >= 1);
});

test('stripBoilerplate preserves a signed thinking-only assistant message', () => {
  const payload = { messages: [
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'r', signature: 's' }] },
  ] };
  stripBoilerplate(payload);
  const blocks = payload.messages[0].content;
  assert.ok(Array.isArray(blocks) && blocks.some((b) => b && b.type === 'thinking'), 'thinking preserved');
});
