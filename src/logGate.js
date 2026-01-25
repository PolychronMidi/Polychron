// logGate.js - Centralized logging/tracing gate with master level control
// Levels: none=0, lite=1, full=2

const path = require('path');
const fs = require('fs');

const LEVELS = { none: 0, lite: 1, full: 2 };
const MASTER = (process.env.MASTER_LOG || process.env.masterLog || '').toLowerCase() || 'none';

// Per-category minimal level defaults
const CATEGORY_DEFAULT_LEVEL = {
  index: 'full',              // index-traces (very verbose)
  debug: 'full',              // ad-hoc debug writes
  perf: 'lite',               // performance warnings
  masterMap: 'lite',          // masterMap diagnostic emissions
  anomalies: 'lite',          // anomaly/overlong unit diagnostics
  repro: 'lite',              // repro hit files
  composerCreation: 'lite',   // composer creation logs
  resetIndex: 'lite'          // reset-index logs
};

// Map legacy env vars to categories (explicit env var overrides true)
const ENV_MAP = {
  INDEX_TRACES: 'index',
  DEBUG_TRACES: 'debug',
  PERF_TRACES: 'perf',
  MASTERMAP_TRACES: 'masterMap',
  ANOMALIES_TRACES: 'anomalies',
  REPRO_TRACES: 'repro',
  COMPOSER_CREATION: 'composerCreation',
  RESET_INDEX: 'resetIndex'
};

function _envFlagSet(envName) {
  if (!envName) return false;
  const v = process.env[envName];
  return v === '1' || String(v).toLowerCase() === 'true';
}

function isEnabled(category) {
  if (!category) return false;
  // If legacy env var explicitly set, honor it
  for (const [env, cat] of Object.entries(ENV_MAP)) {
    if (cat === category && _envFlagSet(env)) return true;
  }

  // Master-level check
  const masterLevel = LEVELS[String(MASTER).toLowerCase()] || 0;
  const want = LEVELS[CATEGORY_DEFAULT_LEVEL[category] || 'full'];
  return masterLevel >= want;
}

function _ensureOutDir() {
  const out = path.join(process.cwd(), 'output');
  try { if (!fs.existsSync(out)) fs.mkdirSync(out, { recursive: true }); } catch (e) {}
  return out;
}

function writeFileForCategory(category, filename, obj) {
  if (!isEnabled(category)) return;
  try {
    const outDir = _ensureOutDir();
    const out = path.join(outDir, filename);
    fs.appendFileSync(out, JSON.stringify(obj) + '\n');
  } catch (e) {
    // swallow
  }
}

function writeIndexTrace(obj) {
  writeFileForCategory('index', 'index-traces.ndjson', obj);
}

function writeDebugFile(filename, obj, category = 'debug') {
  writeFileForCategory(category, filename, obj);
}

module.exports = {
  isEnabled,
  writeIndexTrace,
  writeDebugFile,
  MASTER_LOG: MASTER,
  LEVELS
};
