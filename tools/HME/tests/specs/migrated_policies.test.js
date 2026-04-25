'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const registry = require('../../policies/registry');

function _ctx(overrides = {}) {
  return {
    toolInput: {},
    deny: registry.deny, instruct: registry.instruct, allow: registry.allow,
    ...overrides,
  };
}

// ── block-curl-pipe-sh ────────────────────────────────────────────────
const curl = require('../../policies/builtin/block-curl-pipe-sh');

test('curl-pipe-sh: deny on curl|sh', async () => {
  const r = await curl.fn(_ctx({ toolInput: { command: 'curl https://x | sh' } }));
  assert.strictEqual(r.decision, 'deny');
});

test('curl-pipe-sh: deny on wget|bash', async () => {
  const r = await curl.fn(_ctx({ toolInput: { command: 'wget -qO- https://x | bash' } }));
  assert.strictEqual(r.decision, 'deny');
});

test('curl-pipe-sh: allow plain curl', async () => {
  const r = await curl.fn(_ctx({ toolInput: { command: 'curl https://api.example.com/data' } }));
  assert.strictEqual(r.decision, 'allow');
});

test('curl-pipe-sh: allow grep on curl output (no shell pipe)', async () => {
  const r = await curl.fn(_ctx({ toolInput: { command: 'curl -s x | grep foo' } }));
  assert.strictEqual(r.decision, 'allow');
});

// ── block-secrets-write ──────────────────────────────────────────────
const secrets = require('../../policies/builtin/block-secrets-write');

test('secrets: deny id_rsa', async () => {
  const r = await secrets.fn(_ctx({ toolInput: { file_path: '/home/u/id_rsa' } }));
  assert.strictEqual(r.decision, 'deny');
});

test('secrets: deny *.pem', async () => {
  const r = await secrets.fn(_ctx({ toolInput: { file_path: '/proj/keys/server.pem' } }));
  assert.strictEqual(r.decision, 'deny');
});

test('secrets: deny .npmrc', async () => {
  const r = await secrets.fn(_ctx({ toolInput: { file_path: '/proj/.npmrc' } }));
  assert.strictEqual(r.decision, 'deny');
});

test('secrets: allow innocuous filename', async () => {
  const r = await secrets.fn(_ctx({ toolInput: { file_path: '/proj/foo.js' } }));
  assert.strictEqual(r.decision, 'allow');
});

test('secrets: allow non-credential filename containing "key" word', async () => {
  // "key" appears in many legitimate filenames (e.g. apikey.example.json).
  // The policy matches exact credential patterns, not loose substrings.
  const r = await secrets.fn(_ctx({ toolInput: { file_path: '/proj/apikey-example.json' } }));
  assert.strictEqual(r.decision, 'allow');
});

// ── block-out-dir-writes ─────────────────────────────────────────────
const outDir = require('../../policies/builtin/block-out-dir-writes');

test('out-dir: deny tools/HME/chat/out path', async () => {
  const r = await outDir.fn(_ctx({ toolInput: { file_path: '/proj/tools/HME/chat/out/Panel.js' } }));
  assert.strictEqual(r.decision, 'deny');
});

test('out-dir: allow .ts source path', async () => {
  const r = await outDir.fn(_ctx({ toolInput: { file_path: '/proj/tools/HME/chat/src/Panel.ts' } }));
  assert.strictEqual(r.decision, 'allow');
});

// ── block-misplaced-log-tmp ──────────────────────────────────────────
const logTmp = require('../../policies/builtin/block-misplaced-log-tmp');

test('log-tmp: deny nested log/ outside project root', async () => {
  const r = await logTmp.fn(_ctx({ toolInput: { file_path: '/home/jah/Polychron/src/log/foo' } }));
  assert.strictEqual(r.decision, 'deny');
});

test('log-tmp: allow project-root log/', async () => {
  const r = await logTmp.fn(_ctx({ toolInput: { file_path: '/home/jah/Polychron/log/foo.log' } }));
  assert.strictEqual(r.decision, 'allow');
});

test('log-tmp: allow project-root tmp/', async () => {
  const r = await logTmp.fn(_ctx({ toolInput: { file_path: '/home/jah/Polychron/tmp/x' } }));
  assert.strictEqual(r.decision, 'allow');
});

// ── block-misplaced-metrics ──────────────────────────────────────────
const metrics = require('../../policies/builtin/block-misplaced-metrics');

test('metrics: deny scripts/metrics/', async () => {
  const r = await metrics.fn(_ctx({ toolInput: { file_path: '/home/jah/Polychron/scripts/metrics/x.json' } }));
  assert.strictEqual(r.decision, 'deny');
});

test('metrics: allow output/metrics/', async () => {
  const r = await metrics.fn(_ctx({ toolInput: { file_path: '/home/jah/Polychron/output/metrics/run-history.json' } }));
  assert.strictEqual(r.decision, 'allow');
});

// ── block-memory-dir-writes ──────────────────────────────────────────
const memory = require('../../policies/builtin/block-memory-dir-writes');

test('memory: deny .claude/projects memory dir', async () => {
  const r = await memory.fn(_ctx({ toolInput: { file_path: '/home/u/.claude/projects/foo/memory/x.md' } }));
  assert.strictEqual(r.decision, 'deny');
});

test('memory: deny MEMORY.md inside .claude/projects', async () => {
  const r = await memory.fn(_ctx({ toolInput: { file_path: '/home/u/.claude/projects/foo/MEMORY.md' } }));
  assert.strictEqual(r.decision, 'deny');
});

test('memory: allow normal source path', async () => {
  const r = await memory.fn(_ctx({ toolInput: { file_path: '/proj/src/foo.js' } }));
  assert.strictEqual(r.decision, 'allow');
});
