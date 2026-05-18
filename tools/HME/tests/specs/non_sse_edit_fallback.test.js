'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const { rewriteNonSseEditFallback } = require('../../proxy/edit_validation');

test('rewriteNonSseEditFallback: invalid Edit tool_use rewrites to Read in content[]', () => {
  const body = {
    type: 'message',
    content: [
      { type: 'text', text: 'thinking' },
      { type: 'tool_use', id: 'toolu_1', name: 'Edit', input: { file_path: '/x.js' } },
    ],
  };
  const { body: out, count } = rewriteNonSseEditFallback(body);
  assert.equal(count, 1);
  const block = out.content[1];
  assert.equal(block.name, 'Read');
  assert.equal(block.input.file_path, '/x.js');
  assert.equal(block.input.limit, 50);
});

test('rewriteNonSseEditFallback: valid Edit passes through unchanged', () => {
  const body = {
    type: 'message',
    content: [
      { type: 'tool_use', id: 'toolu_1', name: 'Edit', input: { file_path: '/x.js', old_string: 'a', new_string: 'b' } },
    ],
  };
  const { body: out, count } = rewriteNonSseEditFallback(body);
  assert.equal(count, 0);
  assert.equal(out, body);
});

test('rewriteNonSseEditFallback: no-op Edit (old===new) rewrites to Read', () => {
  const body = {
    type: 'message',
    content: [
      { type: 'tool_use', id: 't', name: 'Edit', input: { file_path: '/x.js', old_string: 'same', new_string: 'same' } },
    ],
  };
  const { count } = rewriteNonSseEditFallback(body);
  assert.equal(count, 1);
});

test('rewriteNonSseEditFallback: multiple tool_use blocks, only invalid Edit gets rewritten', () => {
  const body = {
    type: 'message',
    content: [
      { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/a.js', old_string: 'x', new_string: 'y' } },
      { type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: '/b.js' } },
      { type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'ls' } },
    ],
  };
  const { body: out, count } = rewriteNonSseEditFallback(body);
  assert.equal(count, 1);
  assert.equal(out.content[0].name, 'Edit');
  assert.equal(out.content[1].name, 'Read');
  assert.equal(out.content[2].name, 'Bash');
});

test('rewriteNonSseEditFallback: returns body unchanged for missing content[]', () => {
  const body = { type: 'message' };
  const { count } = rewriteNonSseEditFallback(body);
  assert.equal(count, 0);
});
