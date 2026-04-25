'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const meta = require('../../policies/meta_registry');

test('meta_registry: listAll returns array of rule objects', () => {
  const all = meta.listAll();
  assert.ok(Array.isArray(all));
  assert.ok(all.length > 0);
  // Spot-check shape on the first entry.
  const r = all[0];
  assert.strictEqual(typeof r.name, 'string');
  assert.strictEqual(typeof r.layer, 'string');
  assert.strictEqual(typeof r.category, 'string');
});

test('meta_registry: summary returns total + byLayer breakdown', () => {
  const s = meta.summary();
  assert.strictEqual(typeof s.total, 'number');
  assert.ok(s.total > 0);
  assert.strictEqual(typeof s.byLayer, 'object');
  // Sum of byLayer counts must equal total.
  const sum = Object.values(s.byLayer).reduce((a, b) => a + b, 0);
  assert.strictEqual(sum, s.total);
});

test('meta_registry: hook layer is populated by the hook policy registry', () => {
  const hooks = meta.listByLayer('hook');
  assert.ok(hooks.length >= 4, 'expected at least the 4 original hook policies');
  for (const h of hooks) {
    assert.strictEqual(h.layer, 'hook');
    // Hook policies expose the on/off status (config-aware).
    assert.ok(h.status === 'on' || h.status === 'off',
      `hook policy ${h.name} status must be on|off, got ${h.status}`);
  }
});

test('meta_registry: eslint layer enumerates scripts/eslint-rules/*.js', () => {
  const eslint = meta.listByLayer('eslint');
  assert.ok(eslint.length >= 10, `expected many eslint rules, got ${eslint.length}`);
  for (const r of eslint) {
    assert.strictEqual(r.layer, 'eslint');
    assert.match(r.name, /^local\//, 'eslint rule names should be prefixed local/');
    assert.match(r.file, /scripts\/eslint-rules\//);
  }
});

test('meta_registry: hci layer enumerates verifier classes by their `name` attribute', () => {
  const hci = meta.listByLayer('hci');
  assert.ok(hci.length >= 5, `expected several HCI verifiers, got ${hci.length}`);
  for (const r of hci) {
    assert.strictEqual(r.layer, 'hci');
    assert.match(r.file, /verify_coherence/);
  }
});

test('meta_registry: middleware layer enumerates non-helper middleware files', () => {
  const mw = meta.listByLayer('middleware');
  assert.ok(mw.length >= 10, `expected many middleware modules, got ${mw.length}`);
  for (const r of mw) {
    assert.strictEqual(r.layer, 'middleware');
    assert.match(r.file, /\/middleware\//);
    // Underscore-prefixed files should NOT appear.
    assert.ok(!r.name.startsWith('_'),
      `helper file ${r.name} leaked into middleware layer`);
    // Test files should NOT appear.
    assert.ok(!r.name.includes('test_') && !r.name.includes('.test'),
      `test file ${r.name} leaked into middleware layer`);
  }
});

test('meta_registry: audit layer enumerates scripts/audit-*', () => {
  const audit = meta.listByLayer('audit');
  for (const r of audit) {
    assert.strictEqual(r.layer, 'audit');
    assert.match(r.name, /^audit-/);
  }
});

test('meta_registry: boot layer has the validated-globals entry', () => {
  const boot = meta.listByLayer('boot');
  assert.ok(boot.length >= 1);
  assert.ok(boot.some((r) => r.name === 'boot-validated-globals'));
});

test('meta_registry: hypermeta layer has the jurisdiction entry when manifest exists', () => {
  // The manifest may or may not exist depending on repo state. Skip if absent.
  const fs = require('fs');
  const path = require('path');
  const manifest = path.resolve(__dirname, '..', '..', '..', '..', 'scripts', 'bias-bounds-manifest.json');
  if (!fs.existsSync(manifest)) return;
  const hyp = meta.listByLayer('hypermeta');
  assert.ok(hyp.length >= 1);
  assert.ok(hyp.some((r) => r.name === 'hypermeta-jurisdiction'));
});

test('meta_registry: every entry has name + layer + category as strings', () => {
  const all = meta.listAll();
  for (const r of all) {
    assert.strictEqual(typeof r.name, 'string', `entry missing name: ${JSON.stringify(r)}`);
    assert.strictEqual(typeof r.layer, 'string', `entry missing layer: ${JSON.stringify(r)}`);
    assert.strictEqual(typeof r.category, 'string', `entry missing category: ${JSON.stringify(r)}`);
  }
});
