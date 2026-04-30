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


// Smoke tests for the three new horizon-seed modes shipped this session.
const I_STATUS = path.join(PROJECT_ROOT, 'i', 'status');
function _runStatus(mode) {
  const r = spawnSync(I_STATUS, [`mode=${mode}`], {
    encoding: 'utf8',
    timeout: 15000,
    cwd: PROJECT_ROOT,
    env: { ...process.env, PROJECT_ROOT },
  });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status };
}

test('i/status mode=agent-loop renders Horizon IV view', () => {
  const r = _runStatus('agent-loop');
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /Agent loop|No activity/);
});

test('i/status mode=band-tuning renders Horizon IX view', () => {
  const r = _runStatus('band-tuning');
  assert.strictEqual(r.status, 0);
  // Either reports band proposal or notes missing prerequisite logs
  assert.match(r.stdout, /band[\- _]?tuning|band proposal|No (ground-truth|HCI timeseries)/i);
});

test('i/status mode=hci-by-subtag renders Horizon VI subtag aggregation', () => {
  const r = _runStatus('hci-by-subtag');
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /HCI by subtag|HCI \d/);
});

const I_WHY = path.join(PROJECT_ROOT, 'i', 'why');
function _runWhy(args) {
  const r = spawnSync(I_WHY, args, {
    encoding: 'utf8',
    timeout: 15000,
    cwd: PROJECT_ROOT,
    env: { ...process.env, PROJECT_ROOT },
  });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status };
}

test('i/why mode=verifier-coverage renders Horizon VI coverage view', () => {
  const r = _runWhy(['mode=verifier-coverage']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /Verifier coverage|verifier-coverage/);
});

test('i/status mode=conjugate renders Horizon V joint view', () => {
  const r = _runStatus('conjugate');
  assert.strictEqual(r.status, 0);
  // Either reports the joint distribution or notes missing prerequisite
  assert.match(r.stdout, /Conjugate channel|No.*correlation/i);
});

test('i/status mode=conjugate uses data-driven thresholds when data present', () => {
  const r = _runStatus('conjugate');
  if (/No.*correlation/.test(r.stdout)) return;  // skip if no data
  assert.match(r.stdout, /thresholds:.*medians.*data-driven/);
});

test('i/why mode=verifier-drift renders Horizon VI drift view', () => {
  const r = _runWhy(['mode=verifier-drift']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /verifier-drift|frozen|No verifier/);
});

test('i/why mode=verifier-drift accepts n= lookback parameter', () => {
  const r = _runWhy(['mode=verifier-drift', 'n=10']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /lookback:\s*10/);
});

test('i/why mode=kb-graph renders Horizon III citation graph', () => {
  const r = _runWhy(['mode=kb-graph']);
  assert.strictEqual(r.status, 0);
  // Either reports the graph (entries + edges) or notes lance unavailable
  assert.match(r.stdout, /KB citation graph|KB empty|lance access unavailable/);
});

test('i/why mode=predict <file> renders Horizon I correlation view', () => {
  const r = _runWhy(['mode=predict', 'src/conductor/dynamics/coupling.js']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /predict.*src.conductor|No historical|correlated with edits/);
});

test('i/why mode=predict without path prints usage', () => {
  const r = _runWhy(['mode=predict']);
  assert.strictEqual(r.status, 2);  // exit code 2 for usage error
  assert.match(r.stdout, /Usage:|<file_path>/);
});

test('i/why mode=conscience renders Horizon VIII signature view', () => {
  const r = _runWhy(['mode=conscience']);
  assert.strictEqual(r.status, 0);
  // Either reports the verdict count + signature, or notes empty log
  assert.match(r.stdout, /Architectural conscience|No ground-truth/);
});
