'use strict';

const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function sandbox(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runNode(script, metricsDir, cwd = PROJECT_ROOT) {
  return spawnSync('node', [script], {
    cwd,
    env: { ...process.env, PROJECT_ROOT, METRICS_DIR: metricsDir },
    encoding: 'utf8',
  });
}

test('trace-summary writes to METRICS_DIR and never cwd/metrics', () => {
  const root = sandbox('trace-summary-metrics-');
  const metricsDir = path.join(root, 'output', 'metrics');
  fs.mkdirSync(metricsDir, { recursive: true });
  fs.writeFileSync(path.join(metricsDir, 'trace.jsonl'), JSON.stringify({
    layer: 'L1', section: 0, phrase: 0, measure: 0, beat: 0, timeMs: 0,
    regime: 'coherent', playProb: 0.5, stutterProb: 0.1, density: 0.3, tension: 0.4,
  }) + '\n');
  const cwd = path.join(root, 'cwd');
  fs.mkdirSync(cwd, { recursive: true });
  const r = runNode(path.join(PROJECT_ROOT, 'src/scripts/pipeline/trace-summary.js'), metricsDir, cwd);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(path.join(metricsDir, 'trace-summary.json')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'metrics', 'trace-summary.json')), false);
});

test('snapshot-run reads and writes run history through METRICS_DIR', () => {
  const root = sandbox('snapshot-run-metrics-');
  const metricsDir = path.join(root, 'output', 'metrics');
  fs.mkdirSync(path.join(metricsDir, 'run-history'), { recursive: true });
  fs.writeFileSync(path.join(metricsDir, 'golden-fingerprint.json'), JSON.stringify({
    regimeDistribution: { coherent: 1, exploring: 0, evolving: 0 },
    density: { mean: 0.2, variance: 0.01 }, noteCount: { total: 4 },
    telemetryHealth: { score: 1 }, exceedanceComposite: { uniqueRate: 0 },
    hotspotMigration: { axisShares: {} }, trustFinal: { motifEcho: 0.5 },
    pitchEntropy: 1, trustConvergence: 0.5, activeProfile: 'test',
    meta: { traceEntries: 1 },
  }));
  fs.writeFileSync(path.join(metricsDir, 'trace-summary.json'), JSON.stringify({
    sectionStats: [{ beats: 1, dominantRegime: 'coherent', avgTension: 0.3, profile: 'test' }],
    couplingLabels: {},
  }));
  const cwd = path.join(root, 'cwd');
  fs.mkdirSync(cwd, { recursive: true });
  const r = runNode(path.join(PROJECT_ROOT, 'src/scripts/pipeline/snapshot-run.js'), metricsDir, cwd);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(path.join(metricsDir, 'current-run.json')), true);
  assert.equal(fs.readdirSync(path.join(metricsDir, 'run-history')).filter(f => f.endsWith('.json')).length, 1);
  assert.equal(fs.existsSync(path.join(cwd, 'metrics', 'current-run.json')), false);
});
