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

test('state-files-backed stores are registered from ownership registry', () => {
  const names = reg.listRegistered();
  assert.ok(names.includes('statefile_hme_middleware_processed'));
  assert.ok(names.includes('statefile_hme_universal_pulse_heartbeat'));
  assert.ok(names.includes('statefile_hme_incidents'));
  assert.ok(names.includes('statefile_tool_retry_guard'));
  assert.ok(names.includes('statefile_lifesaver_injections'));
  assert.ok(names.includes('statefile_coherence_events'));
  assert.ok(names.includes('statefile_context_metabolism'));
  assert.ok(names.includes('statefile_team_dispatch_budget'));
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

test('jsonl read preserves valid falsy scalar rows', () => {
  const root = tmpRoot();
  try {
    reg.write('middleware_processed', [false, 0, '', null, { event: 'ok' }], root);
    assert.deepStrictEqual(reg.read('middleware_processed', root), [false, 0, '', null, { event: 'ok' }]);
    const { abs } = reg.paths('middleware_processed', root);
    fs.appendFileSync(abs, 'not-json\n');
    assert.deepStrictEqual(reg.read('middleware_processed', root), [false, 0, '', null, { event: 'ok' }]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('jsonl write rejects non-arrays before touching disk', () => {
  const root = tmpRoot();
  try {
    reg.write('middleware_processed', [{ event: 'kept' }], root);
    const { abs } = reg.paths('middleware_processed', root);
    const before = fs.readFileSync(abs, 'utf8');
    assert.throws(() => reg.write('middleware_processed', { event: 'bad' }, root), /jsonl write requires an array/);
    assert.strictEqual(fs.readFileSync(abs, 'utf8'), before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('append fsyncs appended state before returning', () => {
  const root = tmpRoot();
  try {
    const calls = [];
    const original = fs.fsyncSync;
    fs.fsyncSync = function patched(fd) { calls.push(fd); return original.call(fs, fd); };
    try {
      reg.append('middleware_processed', { event: 'durable' }, root);
    } finally {
      fs.fsyncSync = original;
    }
    assert.ok(calls.length >= 1, 'append should fsync the appended file');
    assert.deepStrictEqual(reg.read('middleware_processed', root), [{ event: 'durable' }]);
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

test('schema gates READS, not only writes (mesh-found P1)', () => {
  const root = tmpRoot();
  try {
    // A valid write round-trips.
    reg.write('omni_swap_state', { idx: 1, ts: 1, fail: 0, chain: 'a' }, root);
    assert.deepStrictEqual(reg.read('omni_swap_state', root), { idx: 1, ts: 1, fail: 0, chain: 'a' });
    // Corrupt/legacy/external write that violates the registered schema but is
    // valid JSON must NOT be returned as trusted wrong-shaped state -> null.
    const { abs } = reg.paths('omni_swap_state', root);
    fs.writeFileSync(abs, JSON.stringify({ idx: 'not-a-number', ts: 1, fail: 0, chain: 'a' }));
    assert.strictEqual(reg.read('omni_swap_state', root), null);
    // Non-JSON garbage still reads as null (unchanged).
    fs.writeFileSync(abs, 'not json at all');
    assert.strictEqual(reg.read('omni_swap_state', root), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('atomic write leaves no temp file and persists content (durability path)', () => {
  const root = tmpRoot();
  try {
    reg.write('omni_swap_state', { idx: 9, ts: 9, fail: 0, chain: 'z' }, root);
    const { abs } = reg.paths('omni_swap_state', root);
    const dir = path.dirname(abs);
    const leftover = fs.readdirSync(dir).filter((f) => f.includes('.tmp'));
    assert.deepStrictEqual(leftover, [], 'no temp file should remain after atomic write');
    assert.deepStrictEqual(reg.read('omni_swap_state', root), { idx: 9, ts: 9, fail: 0, chain: 'z' });
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
