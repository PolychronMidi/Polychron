// stutterConfig.js - shared config, metrics and helper registration for stutter system

// Default tuning configuration (sourced from config.js globals)
if (typeof STUTTER_PROBABILITIES === 'undefined' || typeof STUTTER_PROFILES === 'undefined') {
  console.error('stutterConfig.js: missing STUTTER_PROBABILITIES or STUTTER_PROFILES globals');
  process.exit(1);
}
const DEFAULT_PROBABILITIES = STUTTER_PROBABILITIES;
const DEFAULT_PROFILES = STUTTER_PROFILES;

const config = {
  probabilities: Object.assign({}, DEFAULT_PROBABILITIES),
  profiles: Object.assign({}, DEFAULT_PROFILES)
};

// Simple debug flag controlled by env
const DEBUG = Boolean(typeof process !== 'undefined' && (process.env.DEBUG === 'true' || process.env.DEBUG === '1' || process.env.NODE_DEBUG));
function logDebug(...args) { if (DEBUG && typeof console !== 'undefined' && console && typeof console.debug === 'function') console.debug(...args); }

// Metrics store
const metrics = {
  scheduledCount: 0,
  emittedCount: 0,
  scheduledByProfile: {},
  emittedByProfile: {},
  pendingByTick: new Map()
};

// Helper registration
let _registeredHelper = null; // function

function registerHelper(fn) {
  if (typeof fn === 'function') {
    _registeredHelper = fn;
    try { _registeredHelper._isStutterNotesHelper = true; } catch (e) { /* ignore */ }
    return true;
  }
  _registeredHelper = null;
  return false;
}
function getHelper() { return _registeredHelper; }

// Config API
function _clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
function validateConfig() {
  if (!config.probabilities) config.probabilities = Object.assign({}, DEFAULT_PROBABILITIES);
  if (!config.profiles) config.profiles = Object.assign({}, DEFAULT_PROFILES);

  if (typeof config.probabilities.globalApplyProb !== 'number') config.probabilities.globalApplyProb = 0.2;
  config.probabilities.globalApplyProb = _clamp01(config.probabilities.globalApplyProb);

  const profiles = ['source', 'reflection', 'bass'];
  for (const prof of profiles) {
    const fallback = (config.probabilities.perProb && Number.isFinite(config.probabilities.perProb[prof]))
      ? config.probabilities.perProb[prof]
      : 0;
    const fallbackShift = (config.probabilities.shiftProb && Number.isFinite(config.probabilities.shiftProb[prof]))
      ? config.probabilities.shiftProb[prof]
      : 0;

    if (!config.profiles[prof]) config.profiles[prof] = { perProb: fallback, shiftProb: fallbackShift };
    if (typeof config.profiles[prof].perProb !== 'number') config.profiles[prof].perProb = fallback;
    if (typeof config.profiles[prof].shiftProb !== 'number') config.profiles[prof].shiftProb = fallbackShift;
    config.profiles[prof].perProb = _clamp01(config.profiles[prof].perProb);
    config.profiles[prof].shiftProb = _clamp01(config.profiles[prof].shiftProb);
  }

  return config;
}
function getConfig() { return validateConfig(); }
function setConfig(partial = {}) { Object.assign(config, partial); return validateConfig(); }
function getProfileConfig(profile = 'source') {
  validateConfig();
  return config.profiles[profile] || config.profiles.source;
}

// Metrics API
function getMetrics() {
  return {
    scheduledCount: metrics.scheduledCount,
    emittedCount: metrics.emittedCount,
    scheduledByProfile: Object.assign({}, metrics.scheduledByProfile),
    emittedByProfile: Object.assign({}, metrics.emittedByProfile),
    pendingByTick: new Map(metrics.pendingByTick)
  };
}
function resetMetrics() {
  metrics.scheduledCount = 0;
  metrics.emittedCount = 0;
  metrics.scheduledByProfile = {};
  metrics.emittedByProfile = {};
  metrics.pendingByTick = new Map();
  return true;
}
function incScheduled(n = 1, profile = 'unknown') {
  metrics.scheduledCount += n;
  metrics.scheduledByProfile[profile] = (metrics.scheduledByProfile[profile] || 0) + n;
}
function incEmitted(n = 1, profile = 'unknown') {
  metrics.emittedCount += n;
  metrics.emittedByProfile[profile] = (metrics.emittedByProfile[profile] || 0) + n;
}
function incPendingForTick(tick, n = 1) {
  const key = Math.round(tick);
  metrics.pendingByTick.set(key, (metrics.pendingByTick.get(key) || 0) + n);
}
function decPendingForTick(tick, n = 1) {
  const key = Math.round(tick);
  const cur = metrics.pendingByTick.get(key) || 0;
  const next = Math.max(0, cur - n);
  if (next === 0) metrics.pendingByTick.delete(key); else metrics.pendingByTick.set(key, next);
}

// Expose as a naked global (side-effect require pattern used in this project)
StutterConfig = {
  getConfig,
  setConfig,
  validateConfig,
  getProfileConfig,
  getMetrics,
  resetMetrics,
  incScheduled,
  incEmitted,
  incPendingForTick,
  decPendingForTick,
  registerHelper,
  getHelper,
  logDebug,
  DEBUG
};
