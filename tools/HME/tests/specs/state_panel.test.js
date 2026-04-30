'use strict';
// Smoke tests for i/state. Verifies the panel renders without
// crashing, shows core sections (HCI, KB, last activity), and emits
// the multi-timescale HCI line when timeseries is present.

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const I_STATE = path.join(PROJECT_ROOT, 'i', 'state');

function _run(args = []) {
  const r = spawnSync(I_STATE, args, {
    encoding: 'utf8',
    timeout: 15000,
    cwd: PROJECT_ROOT,
    env: { ...process.env, PROJECT_ROOT },
  });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status };
}

test('i/state renders without crashing', () => {
  const r = _run();
  assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  assert.match(r.stdout, /HME state panel/);
});

test('i/state shows onboarding state line', () => {
  const r = _run();
  assert.match(r.stdout, /onboarding\s+\S+/);
});

test('i/state shows HCI line with verifier count', () => {
  const r = _run();
  assert.match(r.stdout, /HCI\s+\d+(?:\.\d+)?\/100\s+\(\d+\s+verifiers\)/);
});

test('i/state shows multi-timescale phase line when timeseries exists', () => {
  // Skip gracefully if timeseries isn't there (clean checkout)
  const ts = path.join(PROJECT_ROOT, 'output', 'metrics',
    'hme-coherence-timeseries.jsonl');
  if (!fs.existsSync(ts)) return;
  const r = _run();
  // Format: "1m  ago +N.N · 1h  ago +N.N · 1d  ago +N.N · peak NN (Nh ago)"
  assert.match(
    r.stdout,
    /1m\s+ago\s+[+\-\d.]+\s+·\s+1h\s+ago\s+[+\-\d.]+\s+·\s+1d\s+ago\s+[+\-\d.]+\s+·\s+peak\s+\d+/,
    `expected multi-timescale phase line; got:\n${r.stdout}`
  );
});

test('i/state mode=brief omits drill-in footer', () => {
  const r = _run(['mode=brief']);
  assert.strictEqual(r.status, 0);
  assert.doesNotMatch(r.stdout, /Drill-in:/);
});

test('i/state shows pipeline state', () => {
  const r = _run();
  assert.match(r.stdout, /pipeline\s+(idle|RUNNING)/);
});
