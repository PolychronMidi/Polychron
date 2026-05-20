'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveOmo } = require('../../omo_bridge/dependency');
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

test('OMO dependency resolver returns disabled by default', () => {
  const events = [];
  const result = resolveOmo({ enabled: false, telemetry: (e) => events.push(e) });
  assert.equal(result.status, 'disabled');
  assert.equal(result.enabled, false);
  assert.equal(events[0].event, 'omo_dependency_resolved');
});

test('OMO dependency resolver resolves configured relative path and metadata', () => {
  const tmpRoot = path.join(repoRoot, 'tmp');
  fs.mkdirSync(tmpRoot, { recursive: true });
  const sandbox = fs.mkdtempSync(path.join(tmpRoot, 'hme-omo-dep-'));
  try {
    const rel = path.relative(repoRoot, sandbox);
    fs.writeFileSync(path.join(sandbox, 'package.json'), JSON.stringify({ name: 'fake-omo', version: '1.2.3', main: 'index.js' }));
    fs.writeFileSync(path.join(sandbox, 'index.js'), 'module.exports = {};\n');
    const result = resolveOmo({ enabled: true, source: 'path', path: rel });
    assert.equal(result.status, 'ok');
    assert.equal(result.version, '1.2.3');
    assert.equal(result.entrypoint, 'index.js');
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('OMO dependency resolver rejects absolute paths outside project root', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-omo-outside-'));
  try {
    const result = resolveOmo({ enabled: true, source: 'path', path: sandbox });
    assert.equal(result.status, 'error');
    assert.match(result.error, /inside PROJECT_ROOT|relative/);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('OMO dependency resolver resolves package dependencies with export maps', () => {
  const root = fs.mkdtempSync(path.join(repoRoot, 'tmp', 'hme-omo-package-'));
  const pkgDir = path.join(root, 'node_modules', 'fake-exported-omo');
  fs.mkdirSync(path.join(pkgDir, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({
    name: 'fake-exported-omo',
    version: '4.2.3',
    type: 'module',
    exports: { '.': './dist/index.js' },
  }));
  fs.writeFileSync(path.join(pkgDir, 'dist', 'index.js'), 'export default { id: "fake" };\n');
  const prev = module.paths.slice();
  try {
    module.paths.unshift(path.join(root, 'node_modules'));
    const result = resolveOmo({ enabled: true, source: 'package', packageName: 'fake-exported-omo' });
    assert.equal(result.status, 'ok');
    assert.equal(result.version, '4.2.3');
    assert.equal(result.entrypoint, 'dist/index.js');
  } finally {
    module.paths.splice(0, module.paths.length, ...prev);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
