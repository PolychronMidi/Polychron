// Shared utilities for HME pipeline steps.
'use strict';

const fs = require('fs');
const path = require('path');
const hmePaths = require('../../../proxy/hme_paths');

const ROOT = hmePaths.PROJECT_ROOT;
const METRICS_DIR = hmePaths.HME_METRICS_DIR;
const PROJECT_METRICS_DIR = hmePaths.COMPOSITION_METRICS_DIR;

function _resolve(p, forRead = true) {
  if (path.isAbsolute(p)) return p;
  const parts = String(p).split(/[\\/]+/).filter(Boolean);
  if (parts.length >= 3 && parts[0] === 'src' && parts[1] === 'output' && parts[2] === 'metrics') {
    const rest = parts.slice(3);
    return forRead ? hmePaths.readMetricPath(...rest) : hmePaths.writeMetricPath(...rest);
  }
  return path.join(ROOT, p);
}

function metricPath(name, ...parts) { return hmePaths.writeMetricPath(name, ...parts); }
function readMetricPath(name, ...parts) { return hmePaths.readMetricPath(name, ...parts); }
function projectMetricPath(name, ...parts) { return hmePaths.projectMetric(name, ...parts); }
function hmeMetricPath(name, ...parts) { return hmePaths.hmeMetric(name, ...parts); }

function loadJson(p) {
  const abs = _resolve(p, true);
  if (!fs.existsSync(abs)) return null;
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (_e) {
    return null;
  }
}

function loadJsonl(p, tail) {
  const abs = _resolve(p, true);
  if (!fs.existsSync(abs)) return [];
  try {
    let lines = fs.readFileSync(abs, 'utf8').split('\n').filter(Boolean);
    if (tail && tail > 0) lines = lines.slice(-tail);
    return lines.map((l) => {
      try { return JSON.parse(l); } catch (_) { return null; }
    }).filter(Boolean);
  } catch (_e) {
    return [];
  }
}

function writeJson(relPath, data) {
  const abs = _resolve(relPath, false);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(data, null, 2));
}

function writeMetricJson(name, data) {
  writeJson(metricPath(name), data);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

module.exports = {
  ROOT,
  METRICS_DIR,
  PROJECT_METRICS_DIR,
  loadJson,
  loadJsonl,
  writeJson,
  writeMetricJson,
  metricPath,
  readMetricPath,
  projectMetricPath,
  hmeMetricPath,
  clamp,
};
