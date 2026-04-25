'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PersistentMap = require('../../proxy/middleware/_persistent_map');

function _tmp(suffix) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pmap-')), suffix);
}

test('PersistentMap: set/get round-trip in same instance', () => {
  const m = new PersistentMap(_tmp('a.jsonl'));
  m.set('foo', { x: 1 });
  assert.deepStrictEqual(m.get('foo'), { x: 1 });
  assert.strictEqual(m.has('foo'), true);
  assert.strictEqual(m.has('bar'), false);
});

test('PersistentMap: persists across instances (warm-start)', () => {
  const file = _tmp('b.jsonl');
  const m1 = new PersistentMap(file);
  m1.set('persistKey', 'value-1');
  m1.set('another', { nested: true });
  // Simulate proxy restart: new instance, same file.
  const m2 = new PersistentMap(file);
  assert.strictEqual(m2.get('persistKey'), 'value-1');
  assert.deepStrictEqual(m2.get('another'), { nested: true });
});

test('PersistentMap: latest-wins on duplicate key', () => {
  const file = _tmp('c.jsonl');
  const m1 = new PersistentMap(file);
  m1.set('k', 'first');
  m1.set('k', 'second');
  m1.set('k', 'third');
  const m2 = new PersistentMap(file);
  assert.strictEqual(m2.get('k'), 'third', 'latest write wins on reload');
});

test('PersistentMap: missing file → empty map', () => {
  const m = new PersistentMap(_tmp('does-not-exist.jsonl'));
  assert.strictEqual(m.size, 0);
  assert.strictEqual(m.get('anything'), undefined);
});

test('PersistentMap: malformed line skipped, valid lines loaded', () => {
  const file = _tmp('d.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{"k":"good","v":1}\nnot json\n{"k":"also-good","v":2}\n');
  const m = new PersistentMap(file);
  assert.strictEqual(m.get('good'), 1);
  assert.strictEqual(m.get('also-good'), 2);
});

test('PersistentMap: cap eviction drops oldest', () => {
  const m = new PersistentMap(_tmp('e.jsonl'), { cap: 3 });
  m.set('a', 1);
  m.set('b', 2);
  m.set('c', 3);
  m.set('d', 4);  // pushes a out
  assert.strictEqual(m.has('a'), false, 'oldest evicted at cap');
  assert.strictEqual(m.get('d'), 4);
  assert.strictEqual(m.size, 3);
});

test('PersistentMap: delete removes from in-memory (file forgets via compaction)', () => {
  const m = new PersistentMap(_tmp('f.jsonl'));
  m.set('x', 1);
  assert.strictEqual(m.has('x'), true);
  m.delete('x');
  assert.strictEqual(m.has('x'), false);
});

test('PersistentMap: complex value shapes round-trip', () => {
  const file = _tmp('g.jsonl');
  const m1 = new PersistentMap(file);
  m1.set('arr', [1, 2, 3]);
  m1.set('obj', { nested: { deep: 'string', n: 42 } });
  m1.set('null', null);
  const m2 = new PersistentMap(file);
  assert.deepStrictEqual(m2.get('arr'), [1, 2, 3]);
  assert.deepStrictEqual(m2.get('obj'), { nested: { deep: 'string', n: 42 } });
  assert.strictEqual(m2.get('null'), null);
});
