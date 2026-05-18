'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const { editFallbackToReadRewrite, _editToReadFallback, _isInvalidEditInput } = require('../../proxy/sse_rewriters');

function _ctx() {
  const map = new Map();
  return { get: (k) => map.get(k), set: (k, v) => map.set(k, v) };
}

function _drive(rewriter, ctx, events) {
  const out = [];
  for (const [name, data] of events) {
    const r = rewriter(name, data, ctx);
    if (r === null) continue;
    if (r && r.events) { for (const e of r.events) out.push(e); continue; }
    out.push([name, r]);
  }
  return out;
}

test('_isInvalidEditInput: flags missing old_string', () => {
  assert.equal(_isInvalidEditInput({ file_path: '/x', new_string: 'a' }), true);
});

test('_isInvalidEditInput: flags missing new_string', () => {
  assert.equal(_isInvalidEditInput({ file_path: '/x', old_string: 'a' }), true);
});

test('_isInvalidEditInput: flags empty old_string', () => {
  assert.equal(_isInvalidEditInput({ file_path: '/x', old_string: '', new_string: 'a' }), true);
});

test('_isInvalidEditInput: valid Edit input passes', () => {
  assert.equal(_isInvalidEditInput({ file_path: '/x', old_string: 'a', new_string: 'b' }), false);
});

test('_isInvalidEditInput: MultiEdit with one bad edit fails', () => {
  assert.equal(_isInvalidEditInput({ file_path: '/x', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: '', new_string: 'c' }] }), true);
});

test('_isInvalidEditInput: MultiEdit all valid passes', () => {
  assert.equal(_isInvalidEditInput({ file_path: '/x', edits: [{ old_string: 'a', new_string: 'b' }] }), false);
});

test('_editToReadFallback: default limit when no offset/limit', () => {
  assert.deepEqual(_editToReadFallback({ file_path: '/a/b.js' }), { file_path: '/a/b.js', limit: 50 });
});

test('_editToReadFallback: uses offset + limit when provided', () => {
  assert.deepEqual(_editToReadFallback({ file_path: '/x', offset: 100, limit: 80 }), { file_path: '/x', offset: 100, limit: 80 });
});

test('_editToReadFallback: derives limit from start_line/end_line', () => {
  assert.deepEqual(_editToReadFallback({ file_path: '/x', start_line: 50, end_line: 75 }), { file_path: '/x', offset: 50, limit: 26 });
});

test('_editToReadFallback: clamps limit to 500', () => {
  assert.deepEqual(_editToReadFallback({ file_path: '/x', limit: 9999 }), { file_path: '/x', limit: 500 });
});

test('editFallbackToReadRewrite: passes valid Edit through unchanged', () => {
  const ctx = _ctx();
  const valid = JSON.stringify({ file_path: '/x.js', old_string: 'a', new_string: 'b' });
  const events = [
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Edit', input: {} } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: valid } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ];
  const out = _drive(editFallbackToReadRewrite, ctx, events);
  assert.equal(out.length, 3);
  assert.equal(out[0][1].content_block.name, 'Edit');
  assert.equal(out[1][1].delta.partial_json, valid);
});

test('editFallbackToReadRewrite: converts invalid Edit (missing old/new) to Read', () => {
  const ctx = _ctx();
  const invalid = JSON.stringify({ file_path: '/x.js' });
  const events = [
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Edit', input: {} } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: invalid } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ];
  const out = _drive(editFallbackToReadRewrite, ctx, events);
  assert.equal(out.length, 3);
  assert.equal(out[0][1].content_block.name, 'Read', 'start name should be rewritten to Read');
  const readInput = JSON.parse(out[1][1].delta.partial_json);
  assert.equal(readInput.file_path, '/x.js');
  assert.equal(readInput.limit, 50);
});

test('editFallbackToReadRewrite: preserves offset/limit hints from invalid Edit', () => {
  const ctx = _ctx();
  const invalid = JSON.stringify({ file_path: '/x.js', offset: 200, limit: 40 });
  const events = [
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Edit', input: {} } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: invalid } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ];
  const out = _drive(editFallbackToReadRewrite, ctx, events);
  const readInput = JSON.parse(out[1][1].delta.partial_json);
  assert.equal(readInput.offset, 200);
  assert.equal(readInput.limit, 40);
});

test('editFallbackToReadRewrite: ignores non-Edit tool_use blocks', () => {
  const ctx = _ctx();
  const events = [
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ];
  const out = _drive(editFallbackToReadRewrite, ctx, events);
  assert.equal(out.length, 3);
  assert.equal(out[0][1].content_block.name, 'Bash');
});
