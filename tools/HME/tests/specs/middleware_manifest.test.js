'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

function freshMiddleware() {
  const p = require.resolve('../../proxy/middleware');
  delete require.cache[p];
  return require('../../proxy/middleware');
}

test('middleware manifest metadata loads with every module', () => {
  const mw = freshMiddleware();
  const names = mw.loadAll();
  assert.ok(names.length >= 30);
  for (const meta of mw.listMiddleware()) {
    assert.ok(meta.file.endsWith('.js'), `${meta.name} missing file`);
    assert.ok(meta.phase, `${meta.name} missing phase`);
    assert.ok(Array.isArray(meta.effects), `${meta.name} missing effects[]`);
    assert.equal(typeof meta.mutatesPayload, 'boolean', `${meta.name} missing mutatesPayload`);
    assert.equal(typeof meta.mutatesToolResult, 'boolean', `${meta.name} missing mutatesToolResult`);
    assert.ok(['always', 'strict-only'].includes(meta.strictMode), `${meta.name} invalid strictMode`);
    if (meta.mutatesToolResult) {
      assert.equal(typeof meta.idempotencyMarkerRequired, 'boolean', `${meta.name} must state idempotency requirement`);
    }
  }
});

test('strict-only middleware metadata replaces hardcoded non-strict mutator list', () => {
  const mw = freshMiddleware();
  mw.loadAll();
  const byName = Object.fromEntries(mw.listMiddleware().map((m) => [m.name, m]));
  assert.equal(byName.read_context.strictMode, 'strict-only');
  assert.equal(byName.edit_context.strictMode, 'strict-only');
  assert.equal(byName.empty_result_marker.strictMode, 'always');
});
