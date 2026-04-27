'use strict';
// Smoke tests for the i/why mode dispatcher. These run the actual
// scripts via Bash — purpose is to catch dispatch breakage (wrong mode
// routing, missing scripts, syntax errors), not to validate output
// content (which depends on live state).

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const I_WHY = path.join(PROJECT_ROOT, 'i', 'why');

function _run(args) {
  const r = spawnSync(I_WHY, args, {
    encoding: 'utf8',
    timeout: 30000,
    cwd: PROJECT_ROOT,
    env: { ...process.env, PROJECT_ROOT },
  });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status };
}

test('i/why mode=state returns onboarding state', () => {
  const r = _run(['mode=state']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /onboarding state/i);
});

test('i/why mode=block does not crash on empty log', () => {
  const r = _run(['mode=block']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /mode=block/);
});

test('i/why mode=verifier <name> dispatches to verifier handler', () => {
  const r = _run(['mode=verifier', 'doc-drift']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /doc-drift/);
  assert.match(r.stdout, /current:/);
});

test('i/why mode=verifier with typo suggests near-matches', () => {
  const r = _run(['mode=verifier', 'doc-drif']);
  assert.match(r.stdout, /not found|did you mean/);
});

test('i/why mode=hci-drop runs without crashing', () => {
  const r = _run(['mode=hci-drop']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /HCI|hci-drop/);
});

test('i/why mode=hook surfaces recent hook activity', () => {
  const r = _run(['mode=hook']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /mode=hook/);
});

test('i/why with multi-word question dispatches to search (Tier 2)', () => {
  const r = _run(['where', 'is', 'the', 'spam', 'verifier']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /search|retrieval|keywords/i);
});

test('i/why with single unknown token falls through to invariant lookup', () => {
  const r = _run(['nonexistent-invariant-xyz']);
  // returns 1 (not found) but should NOT crash
  assert.notStrictEqual(r.status, 2);
  assert.match(r.stderr + r.stdout, /not found|did you mean/);
});

test('i/why mode=search explicitly works', () => {
  const r = _run(['mode=search', 'spam', 'verifier']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /search|retrieval/i);
});
