'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function _isolate() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-readcache-'));
  process.env.HME_SESSION_READ_CACHE_DIR = tmp;
  for (const k of Object.keys(require.cache)) {
    if (k.includes('/tools/HME/proxy/session_read_cache')
      || k.includes('/tools/HME/proxy/sse_rewriters')
      || k.includes('/tools/HME/proxy/sse_edit_read_rewriter')) delete require.cache[k];
  }
  return tmp;
}

test('session_read_cache: records and reads back file ts per session', () => {
  const dir = _isolate();
  try {
    const cache = require('../../proxy/session_read_cache');
    assert.equal(cache.hasRead('s1', '/a.js'), false);
    cache.recordRead('s1', '/a.js');
    assert.equal(cache.hasRead('s1', '/a.js'), true);
    assert.equal(cache.hasRead('s1', '/b.js'), false);
    assert.equal(cache.hasRead('s2', '/a.js'), false, 'other sessions stay isolated');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('session_read_cache: clearSession wipes only the named session', () => {
  const dir = _isolate();
  try {
    const cache = require('../../proxy/session_read_cache');
    cache.recordRead('s1', '/x');
    cache.recordRead('s2', '/y');
    cache.clearSession('s1');
    assert.equal(cache.hasRead('s1', '/x'), false);
    assert.equal(cache.hasRead('s2', '/y'), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('session_read_cache: ignores empty session_id or file_path', () => {
  const dir = _isolate();
  try {
    const cache = require('../../proxy/session_read_cache');
    cache.recordRead('', '/x');
    cache.recordRead('s', '');
    assert.equal(cache.hasRead('', '/x'), false);
    assert.equal(cache.hasRead('s', ''), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('editFallbackToReadRewrite: records Read tool_uses into the session cache', () => {
  const dir = _isolate();
  try {
    const cache = require('../../proxy/session_read_cache');
    const { editFallbackToReadRewrite } = require('../../proxy/sse_rewriters');
    const ctxMap = new Map([['session_id', 's-track']]);
    const ctx = { get: (k) => ctxMap.get(k), set: (k, v) => ctxMap.set(k, v) };
    const readInput = JSON.stringify({ file_path: '/some/file.js' });
    const events = [
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: readInput } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ];
    for (const [n, d] of events) editFallbackToReadRewrite(n, d, ctx);
    assert.equal(cache.hasRead('s-track', '/some/file.js'), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('editFallbackToReadRewrite: rewrites Edit-without-prior-Read to Read (session-state gate)', () => {
  const dir = _isolate();
  try {
    const { editFallbackToReadRewrite } = require('../../proxy/sse_rewriters');
    const ctxMap = new Map([['session_id', 's-unread']]);
    const ctx = { get: (k) => ctxMap.get(k), set: (k, v) => ctxMap.set(k, v) };
    // Valid Edit input but file was never Read in this session -> rewrite to Read.
    const validEdit = JSON.stringify({ file_path: '/abs/path/file.js', old_string: 'a', new_string: 'b' });
    const out = [];
    const events = [
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Edit', input: {} } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: validEdit } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ];
    for (const [n, d] of events) {
      const r = editFallbackToReadRewrite(n, d, ctx);
      if (r === null) continue;
      if (r && r.events) { for (const e of r.events) out.push(e); continue; }
      out.push([n, r]);
    }
    assert.equal(out[0][1].content_block.name, 'Read', 'unread-target Edit should be rewritten to Read');
    const readInput = JSON.parse(out[1][1].delta.partial_json);
    assert.equal(readInput.file_path, '/abs/path/file.js');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('editFallbackToReadRewrite: lets valid Edit pass when target was previously Read', () => {
  const dir = _isolate();
  try {
    const cache = require('../../proxy/session_read_cache');
    cache.recordRead('s-seen', '/abs/seen.js');
    const { editFallbackToReadRewrite } = require('../../proxy/sse_rewriters');
    const ctxMap = new Map([['session_id', 's-seen']]);
    const ctx = { get: (k) => ctxMap.get(k), set: (k, v) => ctxMap.set(k, v) };
    const validEdit = JSON.stringify({ file_path: '/abs/seen.js', old_string: 'a', new_string: 'b' });
    const out = [];
    const events = [
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Edit', input: {} } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: validEdit } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ];
    for (const [n, d] of events) {
      const r = editFallbackToReadRewrite(n, d, ctx);
      if (r === null) continue;
      if (r && r.events) { for (const e of r.events) out.push(e); continue; }
      out.push([n, r]);
    }
    assert.equal(out[0][1].content_block.name, 'Edit', 'previously-Read target should pass Edit through');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('REPO_ROOT marker so test file is identifiable', () => { assert.ok(REPO_ROOT.endsWith('Polychron')); });

test('readInputNormalizeRewrite: drops pages for non-PDF Read tool calls', () => {
  const dir = _isolate();
  try {
    const { readInputNormalizeRewrite } = require('../../proxy/sse_rewriters');
    const ctxMap = new Map();
    const ctx = { get: (k) => ctxMap.get(k), set: (k, v) => ctxMap.set(k, v) };
    const out = [];
    const events = [
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ file_path: '/abs/source.js', pages: '1', limit: 5 }) } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ];
    for (const [name, data] of events) {
      const r = readInputNormalizeRewrite(name, data, ctx);
      if (r === null) continue;
      if (r && r.events) { for (const e of r.events) out.push(e); continue; }
      out.push([name, r]);
    }
    assert.equal(out[0][1].content_block.name, 'Read');
    assert.deepEqual(JSON.parse(out[1][1].delta.partial_json), { file_path: '/abs/source.js', limit: 5 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('readInputNormalizeRewrite: preserves pages for PDF Read tool calls', () => {
  const dir = _isolate();
  try {
    const { readInputNormalizeRewrite } = require('../../proxy/sse_rewriters');
    const ctxMap = new Map();
    const ctx = { get: (k) => ctxMap.get(k), set: (k, v) => ctxMap.set(k, v) };
    const out = [];
    const events = [
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ file_path: '/abs/doc.pdf', pages: '1-2' }) } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ];
    for (const [name, data] of events) {
      const r = readInputNormalizeRewrite(name, data, ctx);
      if (r === null) continue;
      if (r && r.events) { for (const e of r.events) out.push(e); continue; }
      out.push([name, r]);
    }
    assert.deepEqual(JSON.parse(out[1][1].delta.partial_json), { file_path: '/abs/doc.pdf', pages: '1-2' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
