'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const I_STATUS = path.join(PROJECT_ROOT, 'tools/HME/i/status');
const I_REVIEW = path.join(PROJECT_ROOT, 'tools/HME/i/review');

const CMD_TIMEOUT_MS = Number(process.env.HME_TEST_CMD_TIMEOUT_MS) || 20000;

function run(cmd, args, timeout = CMD_TIMEOUT_MS) {
  const opts = { encoding: 'utf8', timeout, cwd: PROJECT_ROOT, env: { ...process.env, PROJECT_ROOT } };
  let r = spawnSync(cmd, args, opts);
  // status === null means spawnSync killed it at the wall-clock timeout, not a
  // real exit. Worker-dependent i/ commands (i/review mode=forget is a ~35s
  if (r.status === null) r = spawnSync(cmd, args, opts);
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

test('i/status mode=activity compact view hides routine event list but preserves full mode', () => {
  const compact = run(I_STATUS, ['mode=activity']);
  assert.equal(compact.status, 0, compact.stderr);
  if (compact.stdout.includes('routine_events_hidden')) {
    assert.doesNotMatch(compact.stdout, /^\s+inference_call\s+\d+/m);
    assert.doesNotMatch(compact.stdout, /^\s+tool_call\s+\d+/m);
    assert.doesNotMatch(compact.stdout, /^\s+turn_complete\s+\d+/m);
    assert.doesNotMatch(compact.stdout, /routine_compacted/);
  }
  const full = run(I_STATUS, ['mode=activity-full']);
  assert.equal(full.status, 0, full.stderr);
  assert.match(full.stdout, /Activity Digest/);
  assert.doesNotMatch(full.stdout, /Unknown mode/);
});

test('i/status state default is compact; help=true contains drill-ins', () => {
  const compact = run(I_STATUS, ['state']);
  assert.equal(compact.status, 0, compact.stderr);
  assert.match(compact.stdout, /HME state panel/);
  assert.doesNotMatch(compact.stdout, /# Drill-in:/);
  assert.doesNotMatch(compact.stdout, /last KB accept\s+\d+d ago\s+\(stale/);

  const help = run(I_STATUS, ['state', 'help=true']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /# Drill-in:/);
});

test('i/review mode=forget clean output omits static reminder and clean verdict marker', () => {
  const r = run(I_REVIEW, ['mode=forget'], Number(process.env.HME_TEST_REVIEW_TIMEOUT_MS) || 90000);
  assert.equal(r.status, 0, r.stderr);
  if (/Warnings: none found/.test(r.stdout)) {
    assert.doesNotMatch(r.stdout, /## Reminders/);
    assert.doesNotMatch(r.stdout, /HME_REVIEW_VERDICT: clean/);
  }
});
