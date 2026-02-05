// stutterConfig.js - shared config, metrics and helper registration for stutter system

// Default tuning configuration
const config = {
  probabilities: {
    globalApplyProb: 0.2,
    perProb: { source: 0.07, reflection: 0.2, bass: 0.7 },
    shiftProb: { source: 0.15, reflection: 0.7, bass: 0.5 }
  }
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
function getConfig() { return config; }
function setConfig(partial = {}) { Object.assign(config, partial); return config; }

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
