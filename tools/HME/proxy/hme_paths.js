'use strict';

const fs = require('fs');
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

const PROJECT_METRIC_NAMES = new Set([
  'adaptive-state.json',
  'composition-diff.json',
  'composition-diff.md',
  'current-run.json',
  'feedback_graph.json',
  'fingerprint-comparison.json',
  'golden-fingerprint.json',
  'golden-fingerprint.prev.json',
  'hci-snapshot-diff.json',
  'hci-verifier-snapshot.json',
  'journal.md',
  'l0-dump.json',
  'narrative-digest.md',
  'perceptual-report.json',
  'pipeline-summary.json',
  'run-comparison.json',
  'runtime-snapshots.json',
  'system-manifest.json',
  'trace-summary.json',
  'trace.jsonl',
  'verdict-model.json',
]);

const HME_METRIC_NAMES = new Set([
  'detector-stats.jsonl',
  'hci-regression-alert.json',
  'kb-signatures.json',
  'kb-staleness.json',
  'kb-trust-weights.json',
  'legacy-override-history.jsonl',
  'mode-classifier.jsonl',
  'reflections.jsonl',
  'satisfaction.jsonl',
  'todo-graph.md',
  'vram-history.jsonl',
]);

function metricName(parts) { return parts.length > 0 ? String(parts[0]) : ''; }

function isHmeMetricName(...parts) {
  const name = metricName(parts);
  if (!name || PROJECT_METRIC_NAMES.has(name) || name === 'run-history') return false;
  return name.startsWith('hme-') || HME_METRIC_NAMES.has(name);
}

function hmeMetric(...parts) { return path.join(HME_METRICS_DIR, ...parts); }
function hmeState(...parts) { return path.join(HME_STATE_DIR, ...parts); }
function projectMetric(...parts) { return path.join(COMPOSITION_METRICS_DIR, ...parts); }
function metricPath(...parts) { return isHmeMetricName(...parts) ? hmeMetric(...parts) : projectMetric(...parts); }

function readHmeMetric(...parts) {
  const primary = hmeMetric(...parts);
  return fs.existsSync(primary) ? primary : projectMetric(...parts);
}

function readMetricPath(...parts) {
  return isHmeMetricName(...parts) ? readHmeMetric(...parts) : projectMetric(...parts);
}

function writeHmeMetric(...parts) { return hmeMetric(...parts); }
function writeProjectMetric(...parts) { return projectMetric(...parts); }
function writeMetricPath(...parts) { return metricPath(...parts); }

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
  metricPath,
  readHmeMetric,
  readMetricPath,
  writeHmeMetric,
  writeProjectMetric,
  writeMetricPath,
  isHmeMetricName,
};
