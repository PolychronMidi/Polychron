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

// Append directly to an output file regardless of gate — useful for fatal/assert diagnostics
function appendToFile(filename, obj) {
  try {
    const out = _ensureOutDir();
    const p = path.join(out, filename);
    fs.appendFileSync(p, JSON.stringify(obj) + '\n');
  } catch (e) {
    // swallow to avoid cascading failures
  }
}

// Write a fatal/critical diagnostic payload to critical-errors.ndjson (always written)
function writeFatal(obj, filename = 'critical-errors.ndjson') {
  appendToFile(filename, obj);
}

// Convenience helper for detected overlap payloads — writes the short payload and the verbose trace
function writeDetectedOverlap(payload, verbose) {
  try { appendToFile('detected-overlap.ndjson', payload); } catch (e) {}
  try { writeDebugFile('detected-overlap-verbose.ndjson', verbose); } catch (e) {}
}

// Test-mode console gating helpers
let _consoleRestore = null;

function gateConsoleForTests() {
  // Do not gate unless running under NODE_ENV=test
  const testing = process.env.NODE_ENV === 'test';
  const envAllow = !!process.env.ENABLE_LOGS;
  if (!testing) return () => {};
  if (envAllow) return () => {};
  if (_consoleRestore) return _consoleRestore; // already gated

  const _orig = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  // Save previous __POLYCHRON_TEST__.enableLogging so we can restore it
  globalThis.__POLYCHRON_TEST__ = globalThis.__POLYCHRON_TEST__ || {};
  const _origEnableLogging = globalThis.__POLYCHRON_TEST__.enableLogging;
  // Silence conditional logging hooks used throughout the codebase
  globalThis.__POLYCHRON_TEST__.enableLogging = false;

  // Silence normal logs and warnings during tests; redirect errors into output/test-errors.ndjson
  console.log = () => {};
  console.warn = () => {};
  console.error = (...args) => {
    try {
      appendToFile('test-errors.ndjson', { ts: Date.now(), args: args.map(a => (typeof a === 'string' ? a : (a && a.stack ? a.stack : JSON.stringify(a)))) });
    } catch (e) {}
  };

  _consoleRestore = () => {
    console.log = _orig.log;
    console.warn = _orig.warn;
    console.error = _orig.error;
    // Restore previous enableLogging value
    try { globalThis.__POLYCHRON_TEST__ = globalThis.__POLYCHRON_TEST__ || {}; globalThis.__POLYCHRON_TEST__.enableLogging = _origEnableLogging; } catch (e) {}
    _consoleRestore = null;
  };
  return _consoleRestore;
}

function restoreConsoleForTests() {
  if (_consoleRestore) _consoleRestore();
}

// Programmatic API to control silent mode (for scripts/CI)
let _silentMode = false;
function setSilentMode(v = true) {
  _silentMode = !!v;
  if (_silentMode) {
    // Apply gating immediately
    try { gateConsoleForTests(); } catch (e) {}
  } else {
    try { restoreConsoleForTests(); } catch (e) {}
  }
}

function isSilentMode() { return !!_silentMode; }

module.exports = {
  isEnabled,
  writeIndexTrace,
  writeDebugFile,
  appendToFile,
  writeFatal,
  writeDetectedOverlap,
  gateConsoleForTests,
  restoreConsoleForTests,
  setSilentMode,
  isSilentMode,
  MASTER_LOG: MASTER,
  LEVELS
};

// Default to silent logging unless explicitly opted-in via ENABLE_LOGS or MASTER_LOG.
// SILENCE_LOGS=1 forces silence; ENABLE_LOGS=1 or setting MASTER_LOG turns logging on.
try {
  const envAllow = !!process.env.ENABLE_LOGS;
  const masterProvided = !!process.env.MASTER_LOG || !!process.env.masterLog;
  const silenceFlag = process.env.SILENCE_LOGS === '1';

  // SILENCE_LOGS explicit override takes precedence
  if (silenceFlag) {
    setSilentMode(true);
  } else if (envAllow || masterProvided) {
    // Explicit opt-in via env or master logging provided
    setSilentMode(false);
  } else if (process.env.NODE_ENV === 'test') {
    // For test runs default to silent unless ENABLE_LOGS set
    setSilentMode(true);
  } else {
    // Default policy for local/dev runs: silent by default, opt-in to enable logs
    setSilentMode(true);
  }
} catch (e) {}
