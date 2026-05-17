'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..', '..', '..');
const adapter = require('../../proxy/project_adapter');
const hmePaths = require('../../proxy/hme_paths');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const a = path.join(src, ent.name);
    const b = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
}

test('default project adapter loads Polychron contract', () => {
  const cfg = adapter.loadAdapter(repo);
  assert.equal(cfg.project_id, 'polychron');
  assert.equal(adapter.artifactPath('metrics_dir', repo, cfg), path.join(repo, 'src/output/metrics'));
});

test('HME runtime metrics default outside src', () => {
  assert.equal(hmePaths.HME_METRICS_DIR.startsWith(path.join(repo, 'src') + path.sep), false);
  assert.match(hmePaths.HME_METRICS_DIR, /tools[\/]HME[\/]runtime[\/]metrics$/);
});

test('activity emitter resolves template metrics env to HME runtime', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-emit-env-'));
  try {
    const proc = childProcess.spawnSync(
      'python3',
      [path.join(repo, 'tools/HME/activity/emit.py'), '--event=env_path_test'],
      {
        cwd: tmp,
        encoding: 'utf8',
        env: {
          ...process.env,
          PROJECT_ROOT: tmp,
          HME_RUNTIME_DIR: '${PROJECT_ROOT}/tools/HME/runtime',
          HME_METRICS_DIR: '${HME_RUNTIME_DIR}/metrics',
        },
      },
    );
    assert.equal(proc.status, 0, proc.stderr || proc.stdout);
    assert.equal(
      fs.existsSync(path.join(tmp, 'tools/HME/runtime/metrics/hme-activity.jsonl')),
      true,
    );
    assert.equal(fs.existsSync(path.join(tmp, '${HME_RUNTIME_DIR}')), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('generic project fixture passes project health and portability audit', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-generic-project-'));
  copyDir(path.join(repo, 'tools/HME/tests/fixtures/generic-project'), tmp);
  const cfg = adapter.loadAdapter(tmp);
  assert.equal(cfg.project_id, 'generic-fixture');
  const health = childProcess.spawnSync('node', [path.join(repo, 'tools/HME/scripts/project-health.js'), `--root=${tmp}`], { encoding: 'utf8' });
  assert.equal(health.status, 0, health.stderr || health.stdout);
  const audit = childProcess.spawnSync('python3', [path.join(repo, 'tools/HME/scripts/audit-portability.py'), `--root=${tmp}`], { encoding: 'utf8' });
  assert.equal(audit.status, 0, audit.stderr || audit.stdout);
  fs.rmSync(tmp, { recursive: true, force: true });
});


function runAudit(root) {
  return childProcess.spawnSync(
    'python3',
    [path.join(repo, 'tools/HME/scripts/audit-portability.py'), `--root=${root}`],
    { encoding: 'utf8' },
  );
}

test('portability audit ignores prose but catches boundary imports', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-boundary-audit-'));
  try {
    copyDir(path.join(repo, 'tools/HME/tests/fixtures/generic-project'), tmp);
    const hmeDir = path.join(tmp, 'tools', 'HME', 'scripts');
    fs.mkdirSync(hmeDir, { recursive: true });
    fs.writeFileSync(
      path.join(hmeDir, 'core.js'),
      "'use strict';\nconst example = \"allowed='src/foo'\";\n",
    );
    assert.equal(runAudit(tmp).status, 0);
    fs.writeFileSync(
      path.join(hmeDir, 'bad-core.js'),
      "'use strict';\nconst x = require('../../../src/index.js');\n",
    );
    assert.notEqual(runAudit(tmp).status, 0);
    fs.rmSync(path.join(hmeDir, 'bad-core.js'));
    fs.writeFileSync(
      path.join(tmp, 'src', 'bad.js'),
      "'use strict';\nconst x = require('../tools/HME/scripts/core.js');\n",
    );
    assert.notEqual(runAudit(tmp).status, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('project-specific HME analyzer skips when adapter capability is off', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-capability-gate-'));
  try {
    copyDir(path.join(repo, 'tools/HME/tests/fixtures/generic-project'), tmp);
    const metrics = path.join(tmp, 'src', 'output', 'metrics');
    fs.mkdirSync(metrics, { recursive: true });
    const proc = childProcess.spawnSync(
      'node',
      [path.join(repo, 'tools/HME/scripts/pipeline/hme/compute-musical-correlation.js')],
      {
        cwd: tmp,
        encoding: 'utf8',
        env: {
          ...process.env,
          PROJECT_ROOT: tmp,
          METRICS_DIR: metrics,
          HME_PROJECT_ADAPTER: path.join(tmp, 'config/project-adapter.json'),
        },
      },
    );
    assert.equal(proc.status, 0, proc.stderr || proc.stdout);
    assert.match(proc.stdout, /SKIPPED/);
    const out = JSON.parse(fs.readFileSync(
      path.join(tmp, 'tools/HME/runtime/metrics/hme-musical-correlation.json'),
      'utf8',
    ));
    assert.equal(out.skipped, true);
    assert.equal(fs.existsSync(path.join(metrics, 'hme-musical-correlation.json')), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('metric path helpers split HME and composition outputs', () => {
  assert.match(hmePaths.writeMetricPath('hme-activity.jsonl'), /tools[\/]HME[\/]runtime[\/]metrics/);
  assert.match(hmePaths.writeMetricPath('kb-staleness.json'), /tools[\/]HME[\/]runtime[\/]metrics/);
  assert.match(hmePaths.writeMetricPath('pipeline-summary.json'), /src[\/]output[\/]metrics/);
  assert.match(hmePaths.writeMetricPath('trace.jsonl'), /src[\/]output[\/]metrics/);
});


test('perceptual-dependent analyzers skip under generic fixture', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-capability-skip-'));
  try {
    copyDir(path.join(repo, 'tools/HME/tests/fixtures/generic-project'), tmp);
    const metrics = path.join(tmp, 'src', 'output', 'metrics');
    const hmeMetrics = path.join(tmp, 'tools', 'HME', 'runtime', 'metrics');
    fs.mkdirSync(metrics, { recursive: true });
    for (const script of [
      'compute-compositional-trajectory.js',
      'compute-coherence-budget.js',
    ]) {
      const proc = childProcess.spawnSync(
        'node',
        [path.join(repo, 'tools/HME/scripts/pipeline/hme', script)],
        {
          cwd: tmp,
          encoding: 'utf8',
          env: {
            ...process.env,
            PROJECT_ROOT: tmp,
            METRICS_DIR: metrics,
            HME_PROJECT_ADAPTER: path.join(tmp, 'config/project-adapter.json'),
          },
        },
      );
      assert.equal(proc.status, 0, proc.stderr || proc.stdout);
      assert.match(proc.stdout, /SKIPPED/);
    }
    const trajectory = JSON.parse(fs.readFileSync(
      path.join(hmeMetrics, 'hme-trajectory.json'),
      'utf8',
    ));
    const budget = JSON.parse(fs.readFileSync(
      path.join(hmeMetrics, 'hme-coherence-budget.json'),
      'utf8',
    ));
    assert.equal(trajectory.skipped, true);
    assert.equal(budget.skipped, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('feedback-graph analyzer skips under generic fixture', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-feedback-skip-'));
  try {
    copyDir(path.join(repo, 'tools/HME/tests/fixtures/generic-project'), tmp);
    const metrics = path.join(tmp, 'src', 'output', 'metrics');
    const hmeMetrics = path.join(tmp, 'tools', 'HME', 'runtime', 'metrics');
    fs.mkdirSync(metrics, { recursive: true });
    const proc = childProcess.spawnSync(
      'python3',
      [path.join(repo, 'tools/HME/scripts/pipeline/hme/derive-constitution.py')],
      {
        cwd: tmp,
        encoding: 'utf8',
        env: {
          ...process.env,
          PROJECT_ROOT: tmp,
          METRICS_DIR: metrics,
          HME_PROJECT_ADAPTER: path.join(tmp, 'config/project-adapter.json'),
        },
      },
    );
    assert.equal(proc.status, 0, proc.stderr || proc.stdout);
    assert.match(proc.stdout, /SKIPPED/);
    const out = JSON.parse(fs.readFileSync(
      path.join(hmeMetrics, 'hme-constitution.json'),
      'utf8',
    ));
    assert.equal(out.skipped, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('swapped fixture passes health and portability contracts', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-swapped-project-'));
  try {
    copyDir(path.join(repo, 'tools/HME/tests/fixtures/swapped-project'), tmp);
    const cfg = adapter.loadAdapter(tmp);
    assert.equal(cfg.project_id, 'swapped-fixture');
    assert.deepEqual(cfg.source_roots, ['src']);
    assert.deepEqual(cfg.project_docs, ['doc/composition.md']);
    const health = childProcess.spawnSync(
      'node',
      [path.join(repo, 'tools/HME/scripts/project-health.js'), `--root=${tmp}`],
      { encoding: 'utf8' },
    );
    assert.equal(health.status, 0, health.stderr || health.stdout);
    const audit = runAudit(tmp);
    assert.equal(audit.status, 0, audit.stderr || audit.stdout);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('adapter capability matrix defaults closed and honors opt-ins', () => {
  const cfg = adapter.loadAdapter(path.join(repo, 'tools/HME/tests/fixtures/swapped-project'));
  for (const cap of [
    'pipeline_summary',
    'trace',
    'run_history',
    'structured_events',
    'audio_render',
    'perceptual_analysis',
    'feedback_graph',
  ]) {
    assert.equal(adapter.hasCapability(cap, cfg), false, cap);
  }
  const enabled = { capabilities: { trace: true, audio_render: true } };
  assert.equal(adapter.hasCapability('trace', enabled), true);
  assert.equal(adapter.hasCapability('audio_render', enabled), true);
  assert.equal(adapter.hasCapability('feedback_graph', enabled), false);
});
