'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const paths = require('../../proxy/infra/paths');

test('projectPath joins relative to PROJECT_ROOT', () => {
  assert.equal(paths.projectPath('a', 'b.txt'), path.join(paths.PROJECT_ROOT, 'a', 'b.txt'));
});

test('runtimePath / metricsPath / statePath all live under tools/HME/runtime', () => {
  assert.ok(paths.runtimePath('x').endsWith('tools/HME/runtime/x'));
  assert.ok(paths.metricsPath('y').endsWith('tools/HME/runtime/metrics/y'));
  assert.ok(paths.statePath('z').endsWith('tools/HME/runtime/state/z'));
});

test('tmp/log/src helpers compose under PROJECT_ROOT', () => {
  assert.equal(paths.tmpPath('foo'), path.join(paths.PROJECT_ROOT, 'tmp', 'foo'));
  assert.equal(paths.logPath('foo.log'), path.join(paths.PROJECT_ROOT, 'log', 'foo.log'));
  assert.equal(paths.srcOutputPath('out.bin'), path.join(paths.PROJECT_ROOT, 'src', 'output', 'out.bin'));
  assert.equal(paths.srcMetricsPath('o.json'), path.join(paths.PROJECT_ROOT, 'src', 'output', 'metrics', 'o.json'));
  assert.equal(paths.hmePath('proxy', 'paths.js'), path.join(paths.PROJECT_ROOT, 'tools', 'HME', 'proxy', 'paths.js'));
});

test('helpers with no segments return the directory itself', () => {
  assert.equal(paths.runtimePath(), path.join(paths.PROJECT_ROOT, 'tools', 'HME', 'runtime'));
  assert.equal(paths.tmpPath(), path.join(paths.PROJECT_ROOT, 'tmp'));
});
