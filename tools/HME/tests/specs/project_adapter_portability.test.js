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
