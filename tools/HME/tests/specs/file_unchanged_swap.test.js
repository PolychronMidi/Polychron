'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { swapFileUnchanged } = require('../../proxy/file_unchanged_swap');

function readUse(id, file_path) {
  return { type: 'tool_use', id, name: 'Read', input: { file_path } };
}
function readResult(id, text) {
  return { type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }] };
}
function readResultStr(id, text) {
  return { type: 'tool_result', tool_use_id: id, content: text };
}

test('swap moves earlier Read content into the Wasted-call slot', () => {
  const messages = [
    { role: 'assistant', content: [readUse('r1', '/x/foo.js')] },
    { role: 'user', content: [readResult('r1', '1\tfoo line 1\n2\tfoo line 2\n')] },
    { role: 'assistant', content: [{ type: 'text', text: 'thinking' }] },
    { role: 'user', content: [{ type: 'text', text: 'continue' }] },
    { role: 'assistant', content: [readUse('r2', '/x/foo.js')] },
    { role: 'user', content: [readResult('r2', 'Wasted call — file unchanged since your last Read. Refer to that earlier tool_result instead.')] },
  ];
  const swaps = swapFileUnchanged(messages);
  assert.equal(swaps, 1);
  // r2 slot now holds the original r1 content
  assert.match(messages[5].content[0].content[0].text, /1\tfoo line 1/);
  // r1 slot now holds the pointer
  assert.match(messages[1].content[0].content[0].text, /moved forward/);
});

test('Wasted call with no earlier Read content is left alone', () => {
  const messages = [
    { role: 'assistant', content: [readUse('r1', '/x/foo.js')] },
    { role: 'user', content: [readResult('r1', 'Wasted call — file unchanged since your last Read.')] },
  ];
  const before = JSON.stringify(messages);
  const swaps = swapFileUnchanged(messages);
  assert.equal(swaps, 0);
  assert.equal(JSON.stringify(messages), before);
});

test('Wasted call for file A does not pull content from a Read of file B', () => {
  const messages = [
    { role: 'assistant', content: [readUse('r1', '/x/B.js')] },
    { role: 'user', content: [readResult('r1', 'content of B')] },
    { role: 'assistant', content: [readUse('r2', '/x/A.js')] },
    { role: 'user', content: [readResult('r2', 'Wasted call — file unchanged since your last Read.')] },
  ];
  const swaps = swapFileUnchanged(messages);
  assert.equal(swaps, 0, 'cross-file pull is forbidden');
  assert.match(messages[3].content[0].content[0].text, /Wasted call/, 'wasted message still in place');
});

test('chain of two Wasted calls each pulls from the most recent good content forward', () => {
  const messages = [
    { role: 'assistant', content: [readUse('r1', '/x/foo.js')] },
    { role: 'user', content: [readResult('r1', 'real content v1')] },
    { role: 'assistant', content: [readUse('r2', '/x/foo.js')] },
    { role: 'user', content: [readResult('r2', 'Wasted call — file unchanged since your last Read.')] },
    { role: 'assistant', content: [readUse('r3', '/x/foo.js')] },
    { role: 'user', content: [readResult('r3', 'Wasted call — file unchanged since your last Read.')] },
  ];
  const swaps = swapFileUnchanged(messages);
  assert.equal(swaps, 2, 'both wasted slots get filled');
  // r3 (latest) ends up with the real content
  assert.equal(messages[5].content[0].content[0].text, 'real content v1');
  // r1 and r2 carry pointer text
  assert.match(messages[1].content[0].content[0].text, /moved forward/);
  assert.match(messages[3].content[0].content[0].text, /moved forward/);
});

test('string-shaped tool_result content (not array) also gets swapped', () => {
  const messages = [
    { role: 'assistant', content: [readUse('r1', '/x/foo.js')] },
    { role: 'user', content: [readResultStr('r1', '1\tline one\n')] },
    { role: 'assistant', content: [readUse('r2', '/x/foo.js')] },
    { role: 'user', content: [readResultStr('r2', 'Wasted call — file unchanged since your last Read.')] },
  ];
  const swaps = swapFileUnchanged(messages);
  assert.equal(swaps, 1);
  const after = messages[3].content[0].content;
  const text = typeof after === 'string' ? after : after[0].text;
  assert.equal(text, '1\tline one\n');
});

test('non-Read tool_use results are not eligible (e.g. Grep)', () => {
  const grepUse = { type: 'tool_use', id: 'g1', name: 'Grep', input: { pattern: 'foo', path: '/x/foo.js' } };
  const messages = [
    { role: 'assistant', content: [grepUse] },
    { role: 'user', content: [readResult('g1', 'some match output')] },
    { role: 'assistant', content: [grepUse] },
    { role: 'user', content: [readResult('g1', 'Wasted call — file unchanged since your last Read.')] },
  ];
  // Wasted-call response is only emitted for Read; even if some other tool's
  // result looked similar, the policy only acts on Read tool_uses.
  const swaps = swapFileUnchanged(messages);
  assert.equal(swaps, 0);
});

test('Fs$ variant of the unchanged message also triggers the swap', () => {
  const messages = [
    { role: 'assistant', content: [readUse('r1', '/x/foo.js')] },
    { role: 'user', content: [readResult('r1', 'real content')] },
    { role: 'assistant', content: [readUse('r2', '/x/foo.js')] },
    { role: 'user', content: [readResult('r2', 'File unchanged since last read. The content from the earlier Read tool_result in this conversation is still current — refer to that instead of re-reading.')] },
  ];
  const swaps = swapFileUnchanged(messages);
  assert.equal(swaps, 1);
});
