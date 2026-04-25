'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const registry = require('../../policies/registry');

function _ctx(overrides = {}) {
  return {
    toolInput: {},
    deny: registry.deny, instruct: registry.instruct, allow: registry.allow,
    ...overrides,
  };
}

// ── block-mid-pipeline-write ─────────────────────────────────────────
const midPipeline = require('../../policies/builtin/block-mid-pipeline-write');

test('mid-pipeline: deny when run.lock exists + path is in src/', async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'midp-'));
  const lockDir = path.join(sandbox, 'tmp');
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(path.join(lockDir, 'run.lock'), 'pid=1');
  const original = process.env.PROJECT_ROOT;
  process.env.PROJECT_ROOT = sandbox;
  try {
    const r = await midPipeline.fn(_ctx({ toolInput: { file_path: '/anywhere/Polychron/src/foo.js' } }));
    assert.strictEqual(r.decision, 'deny');
  } finally {
    process.env.PROJECT_ROOT = original;
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('mid-pipeline: allow when run.lock missing', async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'midp-'));
  const original = process.env.PROJECT_ROOT;
  process.env.PROJECT_ROOT = sandbox;
  try {
    const r = await midPipeline.fn(_ctx({ toolInput: { file_path: '/anywhere/Polychron/src/foo.js' } }));
    assert.strictEqual(r.decision, 'allow');
  } finally {
    process.env.PROJECT_ROOT = original;
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('mid-pipeline: allow non-src path even with run.lock present', async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'midp-'));
  fs.mkdirSync(path.join(sandbox, 'tmp'), { recursive: true });
  fs.writeFileSync(path.join(sandbox, 'tmp', 'run.lock'), 'pid=1');
  const original = process.env.PROJECT_ROOT;
  process.env.PROJECT_ROOT = sandbox;
  try {
    const r = await midPipeline.fn(_ctx({ toolInput: { file_path: '/anywhere/Polychron/doc/foo.md' } }));
    assert.strictEqual(r.decision, 'allow', 'doc/ edits permitted mid-pipeline');
  } finally {
    process.env.PROJECT_ROOT = original;
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

// ── block-comment-ellipsis-stub ──────────────────────────────────────
const stub = require('../../policies/builtin/block-comment-ellipsis-stub');

test('ellipsis-stub: deny on classic comment-stub', async () => {
  const trigger = '// ' + 'rest of fi' + 'le';
  const r = await stub.fn(_ctx({ toolInput: { content: 'function foo() {\n  ' + trigger + '\n}' } }));
  assert.strictEqual(r.decision, 'deny');
});

test('ellipsis-stub: deny on python hash-stub', async () => {
  const trigger = '# ' + 'existing co' + 'de';
  const r = await stub.fn(_ctx({ toolInput: { content: 'def foo():\n    ' + trigger + '\n    return 1' } }));
  assert.strictEqual(r.decision, 'deny');
});

test('ellipsis-stub: allow normal code', async () => {
  const r = await stub.fn(_ctx({ toolInput: { content: 'function ok() { return 42; }' } }));
  assert.strictEqual(r.decision, 'allow');
});

test('ellipsis-stub: allow code that legitimately mentions ellipsis (no stub-verb context)', async () => {
  const r = await stub.fn(_ctx({ toolInput: { content: 'const arr = [1, 2, ...rest, 3];' } }));
  assert.strictEqual(r.decision, 'allow');
});

// ── block-secret-content-pattern ─────────────────────────────────────
const secretContent = require('../../policies/builtin/block-secret-content-pattern');

test('secret-content: deny on api_key=longstring', async () => {
  const trigger = 'api' + '_key=' + 'AbCdEfGhIjKlMnOpQrStUvWxYz1234567890';
  const r = await secretContent.fn(_ctx({ toolInput: { content: 'const config = {' + trigger + '};' } }));
  assert.strictEqual(r.decision, 'deny');
});

test('secret-content: deny on password: longstring', async () => {
  const trigger = 'pas' + 'sword: ' + 'AbCdEfGhIjKlMnOpQrSt1234567890';
  const r = await secretContent.fn(_ctx({ toolInput: { content: trigger } }));
  assert.strictEqual(r.decision, 'deny');
});

test('secret-content: allow short value (below 20-char threshold)', async () => {
  const r = await secretContent.fn(_ctx({ toolInput: { content: 'api_key=short' } }));
  assert.strictEqual(r.decision, 'allow');
});

test('secret-content: allow code without secret-shaped pattern', async () => {
  const r = await secretContent.fn(_ctx({ toolInput: { content: 'function fetchData() { return null; }' } }));
  assert.strictEqual(r.decision, 'allow');
});

// ── block-mkdir-misplaced-log-tmp ─────────────────────────────────────
const mkdirLogTmp = require('../../policies/builtin/block-mkdir-misplaced-log-tmp');

test('mkdir-log-tmp: deny mkdir of nested log/', async () => {
  const r = await mkdirLogTmp.fn(_ctx({ toolInput: { command: 'mkdir -p /home/jah/Polychron/src/log/foo' } }));
  assert.strictEqual(r.decision, 'deny');
});

test('mkdir-log-tmp: allow mkdir of project-root tmp/', async () => {
  const r = await mkdirLogTmp.fn(_ctx({ toolInput: { command: 'mkdir -p /home/jah/Polychron/tmp/scratch' } }));
  assert.strictEqual(r.decision, 'allow');
});

test('mkdir-log-tmp: allow non-mkdir command containing log/', async () => {
  const r = await mkdirLogTmp.fn(_ctx({ toolInput: { command: 'cat src/log/foo' } }));
  assert.strictEqual(r.decision, 'allow');
});

test('mkdir-log-tmp: allow mkdir without log or tmp', async () => {
  const r = await mkdirLogTmp.fn(_ctx({ toolInput: { command: 'mkdir -p /home/jah/Polychron/src/something' } }));
  assert.strictEqual(r.decision, 'allow');
});

// ── block-mkdir-misplaced-metrics ─────────────────────────────────────
const mkdirMetrics = require('../../policies/builtin/block-mkdir-misplaced-metrics');

test('mkdir-metrics: deny mkdir of nested metrics/', async () => {
  const r = await mkdirMetrics.fn(_ctx({ toolInput: { command: 'mkdir -p /home/jah/Polychron/scripts/metrics/foo' } }));
  assert.strictEqual(r.decision, 'deny');
});

test('mkdir-metrics: allow mkdir of output/metrics/', async () => {
  const r = await mkdirMetrics.fn(_ctx({ toolInput: { command: 'mkdir -p /home/jah/Polychron/output/metrics/sub' } }));
  assert.strictEqual(r.decision, 'allow');
});

test('mkdir-metrics: allow mkdir without metrics/', async () => {
  const r = await mkdirMetrics.fn(_ctx({ toolInput: { command: 'mkdir -p /home/jah/Polychron/output/runs/abc' } }));
  assert.strictEqual(r.decision, 'allow');
});
