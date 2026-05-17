'use strict';
// Smoke tests for i/status timeline. Verifies the dispatcher routes correctly,
// the window= argument parses (s/m/h suffixes), the marker-files +
// activity-log join produces output, and the run-length collapse
// works (no duplicate consecutive lines).

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const I_STATUS = path.join(PROJECT_ROOT, 'tools', 'HME', 'i', 'status');

function _run(args) {
  const r = spawnSync(I_STATUS, ['timeline', ...args], {
    encoding: 'utf8',
    timeout: 15000,
    cwd: PROJECT_ROOT,
    env: { ...process.env, PROJECT_ROOT },
  });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status };
}

test('i/status timeline default window prints header and drill-in section', () => {
  const r = _run([]);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /HME timeline/);
  assert.match(r.stdout, /When in doubt:/);
});

test('i/status timeline window=5m parses minute suffix', () => {
  const r = _run(['window=5m']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /window=5m/);
});

test('i/status timeline window=30s parses second suffix', () => {
  const r = _run(['window=30s']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /window=0m/);  // 30s rounds to 0m in display
});

test('i/status timeline window=1h parses hour suffix', () => {
  const r = _run(['window=1h']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /window=60m/);
});

test('i/status timeline run-length-collapses consecutive same events', () => {
  const r = _run(['window=1h']);
  assert.strictEqual(r.status, 0);
  // If there are any RL-collapsed entries, they appear as `Nx event_name`.
  // We don't assert presence (depends on activity), but if there are
  // multi-count entries, none of them should have count <2.
  const matches = [...r.stdout.matchAll(/^\s*\d{2}:\d{2}:\d{2}.*?\s(\d+)\*\s/gm)];
  for (const m of matches) {
    const n = parseInt(m[1], 10);
    assert.ok(n >= 2, `RL-collapse should only show count for 2+ events, got ${n} in: ${m}`);
  }
});

test('i/status timeline invalid window= falls back to default', () => {
  const r = _run(['window=garbage']);
  assert.strictEqual(r.status, 0);
  // Default is 30m
  assert.match(r.stdout, /window=30m/);
});

test('i/status timeline header reports raw vs grouped event counts', () => {
  const r = _run(['window=1h']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /\d+ raw events -> \d+ grouped/);
});
