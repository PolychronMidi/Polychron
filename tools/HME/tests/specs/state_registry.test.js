'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const reg = require('../../proxy/state_registry');

function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-registry-'));
  return dir;
}

test('canonical stores are registered up-front', () => {
  const names = reg.listRegistered();
  assert.ok(names.includes('omni_swap_state'));
  assert.ok(names.includes('turn_edits'));
});

test('register rejects unsupported format', () => {
  assert.throws(() => reg.register({ name: 'x', relPath: 'tmp/x.bin', format: 'bin' }), /unsupported format/);
});

test('write+read round-trips a JSON store via atomic rename', () => {
  const root = tmpRoot();
  try {
    reg.write('omni_swap_state', { idx: 2, ts: 123, fail: 1, chain: 'a|b' }, root);
    const got = reg.read('omni_swap_state', root);
    assert.deepStrictEqual(got, { idx: 2, ts: 123, fail: 1, chain: 'a|b' });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('schema rejects bad payload', () => {
  const root = tmpRoot();
  try {
    assert.throws(
      () => reg.write('omni_swap_state', { idx: 'nope', ts: 0, fail: 0, chain: '' }, root),
      /idx must be number/,
    );
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('jsonl append + read works', () => {
  const root = tmpRoot();
  try {
    reg.append('middleware_processed', { event: 'a' }, root);
    reg.append('middleware_processed', { event: 'b' }, root);
    const lines = reg.read('middleware_processed', root);
    assert.deepStrictEqual(lines, [{ event: 'a' }, { event: 'b' }]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('missing file reads as null/empty for the appropriate format', () => {
  const root = tmpRoot();
  try {
    assert.strictEqual(reg.read('omni_swap_state', root), null);
    assert.deepStrictEqual(reg.read('middleware_processed', root), []);
    assert.strictEqual(reg.read('turn_edits', root), '');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('reset removes the file', () => {
  const root = tmpRoot();
  try {
    reg.write('omni_swap_state', { idx: 0, ts: 0, fail: 0, chain: '' }, root);
    reg.reset('omni_swap_state', root);
    assert.strictEqual(reg.read('omni_swap_state', root), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('unregistered store throws on access', () => {
  const root = tmpRoot();
  try {
    assert.throws(() => reg.read('does_not_exist', root), /unregistered store/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
