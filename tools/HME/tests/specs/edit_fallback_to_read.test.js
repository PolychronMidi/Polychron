'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { editFallbackToReadRewrite } = require('../../proxy/sse_rewriters');
const { editToReadFallback: _editToReadFallback, isInvalidEditInput: _isInvalidEditInput, editIsStale: _editIsStale } = require('../../proxy/edit_validation');

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

test('_isInvalidEditInput: flags display-redacted marker in old_string', () => {
  assert.equal(_isInvalidEditInput({ file_path: '/x', old_string: 'foo <' + 'display-redacted' + '> bar', new_string: 'baz' }), true);
});

test('_isInvalidEditInput: flags no-op (old_string === new_string)', () => {
  assert.equal(_isInvalidEditInput({ file_path: '/x', old_string: 'same', new_string: 'same' }), true);
});

test('_isInvalidEditInput: MultiEdit flags display-redacted inside edits', () => {
  const trigger = 'foo <' + 'display-redacted' + '> bar';
  assert.equal(_isInvalidEditInput({ file_path: '/x', edits: [{ old_string: trigger, new_string: 'b' }] }), true);
});

test('_isInvalidEditInput: MultiEdit flags no-op edit', () => {
  assert.equal(_isInvalidEditInput({ file_path: '/x', edits: [{ old_string: 'same', new_string: 'same' }] }), true);
});

test('_editIsStale: returns true when old_string is not in actual file', () => {
  const tmp = path.join(os.tmpdir(), `hme-stale-${Date.now()}.txt`);
  fs.writeFileSync(tmp, 'hello world\n');
  try {
    assert.equal(_editIsStale({ file_path: tmp, old_string: 'NOT_PRESENT' }), true);
    assert.equal(_editIsStale({ file_path: tmp, old_string: 'hello' }), false);
  } finally { fs.rmSync(tmp, { force: true }); }
});

test('_editIsStale: skips relative paths (ambiguous)', () => {
  assert.equal(_editIsStale({ file_path: 'rel/path.js', old_string: 'x' }), false);
});

test('_editIsStale: skips when file does not exist (lets natural failure surface)', () => {
  assert.equal(_editIsStale({ file_path: '/nonexistent/path/here.txt', old_string: 'x' }), false);
});

test('editFallbackToReadRewrite: converts no-op Edit (old===new) to Read', () => {
  const ctx = _ctx();
  const noOp = JSON.stringify({ file_path: '/x.js', old_string: 'same', new_string: 'same' });
  const events = [
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Edit', input: {} } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: noOp } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ];
  const out = _drive(editFallbackToReadRewrite, ctx, events);
  assert.equal(out[0][1].content_block.name, 'Read');
  const readInput = JSON.parse(out[1][1].delta.partial_json);
  assert.equal(readInput.file_path, '/x.js');
});

test('editFallbackToReadRewrite: converts display-redacted Edit to Read', () => {
  const ctx = _ctx();
  const redacted = JSON.stringify({ file_path: '/x.js', old_string: 'a <' + 'display-redacted' + '> b', new_string: 'q' });
  const events = [
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Edit', input: {} } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: redacted } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ];
  const out = _drive(editFallbackToReadRewrite, ctx, events);
  assert.equal(out[0][1].content_block.name, 'Read');
});

test('editFallbackToReadRewrite: converts stale Edit (old_string absent from file) to Read', () => {
  const tmp = path.join(os.tmpdir(), `hme-edit-stale-${Date.now()}.txt`);
  fs.writeFileSync(tmp, 'actual content here\n');
  try {
    const ctx = _ctx();
    const stale = JSON.stringify({ file_path: tmp, old_string: 'WRONG GUESS', new_string: 'fix' });
    const events = [
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Edit', input: {} } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: stale } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ];
    const out = _drive(editFallbackToReadRewrite, ctx, events);
    assert.equal(out[0][1].content_block.name, 'Read');
    const readInput = JSON.parse(out[1][1].delta.partial_json);
    assert.equal(readInput.file_path, tmp);
  } finally { fs.rmSync(tmp, { force: true }); }
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

test('editFallbackToReadRewrite: converts Update-without-prior-Read to Read before native edit can fail', () => {
  const sessionId = `s-update-unread-${Date.now()}-${Math.random()}`;
  const cache = require('../../proxy/session_read_cache');
  cache.clearSession(sessionId);
  const map = new Map([['session_id', sessionId]]);
  const ctx = { get: (k) => map.get(k), set: (k, v) => map.set(k, v) };
  const input = JSON.stringify({ file_path: '/abs/update-target.js', old_string: 'a', new_string: 'b' });
  const events = [
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_update', name: 'Update', input: {} } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: input } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ];
  const out = _drive(editFallbackToReadRewrite, ctx, events);
  assert.equal(out[0][1].content_block.name, 'Read');
  const readInput = JSON.parse(out[1][1].delta.partial_json);
  assert.deepEqual(readInput, { file_path: '/abs/update-target.js', limit: 50 });
});

test('editFallbackToReadRewrite: converts invalid Update to Read even without session cache', () => {
  const ctx = _ctx();
  const input = JSON.stringify({ file_path: '/abs/update-target.js' });
  const events = [
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_update', name: 'Update', input: {} } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: input } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ];
  const out = _drive(editFallbackToReadRewrite, ctx, events);
  assert.equal(out[0][1].content_block.name, 'Read');
});
