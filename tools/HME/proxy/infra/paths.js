'use strict';

const path = require('path');
const { PROJECT_ROOT } = require('../shared');

function projectPath(...segments) {
  return path.join(PROJECT_ROOT, ...segments);
}

function runtimePath(...segments) {
  return path.join(PROJECT_ROOT, 'tools', 'HME', 'runtime', ...segments);
}

function metricsPath(...segments) {
  return path.join(PROJECT_ROOT, 'tools', 'HME', 'runtime', 'metrics', ...segments);
}

function statePath(...segments) {
  return path.join(PROJECT_ROOT, 'tools', 'HME', 'runtime', 'state', ...segments);
}

function tmpPath(...segments) {
  return path.join(PROJECT_ROOT, 'tmp', ...segments);
}

function logPath(...segments) {
  return path.join(PROJECT_ROOT, 'log', ...segments);
}

function srcOutputPath(...segments) {
  return path.join(PROJECT_ROOT, 'src', 'output', ...segments);
}

function srcMetricsPath(...segments) {
  return path.join(PROJECT_ROOT, 'src', 'output', 'metrics', ...segments);
}

function hmePath(...segments) {
  return path.join(PROJECT_ROOT, 'tools', 'HME', ...segments);
}

module.exports = {
  PROJECT_ROOT,
  projectPath,
  runtimePath,
  metricsPath,
  statePath,
  tmpPath,
  logPath,
  srcOutputPath,
  srcMetricsPath,
  hmePath,
};
