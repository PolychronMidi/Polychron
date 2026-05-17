use strict';

const path = require('path');

const PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '..', '..', '..');

function underRoot(candidate, fallback) {
  const absRoot = path.resolve(PROJECT_ROOT);
  if (!candidate) return fallback;
  const abs = path.resolve(candidate);
  if (abs === absRoot || abs.startsWith(absRoot + path.sep)) return abs;
  return fallback;
}

const HME_RUNTIME_DIR = underRoot(
  process.env.HME_RUNTIME_DIR,
  path.join(PROJECT_ROOT, 'tools', 'HME', 'runtime'),
);
const HME_METRICS_DIR = underRoot(
  process.env.HME_METRICS_DIR,
  path.join(HME_RUNTIME_DIR, 'metrics'),
);
const HME_STATE_DIR = underRoot(
  process.env.HME_STATE_DIR,
  path.join(HME_RUNTIME_DIR, 'state'),
);
const COMPOSITION_OUTPUT_DIR = underRoot(
  process.env.COMPOSITION_OUTPUT_DIR,
  path.join(PROJECT_ROOT, 'src', 'output'),
);
const COMPOSITION_METRICS_DIR = underRoot(
  process.env.COMPOSITION_METRICS_DIR || process.env.METRICS_DIR,
  path.join(COMPOSITION_OUTPUT_DIR, 'metrics'),
);

function hmeMetric(...parts) { return path.join(HME_METRICS_DIR, ...parts); }
function hmeState(...parts) { return path.join(HME_STATE_DIR, ...parts); }
function projectMetric(...parts) { return path.join(COMPOSITION_METRICS_DIR, ...parts); }

module.exports = {
  PROJECT_ROOT,
  HME_RUNTIME_DIR,
  HME_METRICS_DIR,
  HME_STATE_DIR,
  COMPOSITION_OUTPUT_DIR,
  COMPOSITION_METRICS_DIR,
  hmeMetric,
  hmeState,
  projectMetric,
};
