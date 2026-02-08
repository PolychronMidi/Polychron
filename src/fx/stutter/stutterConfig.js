// stutterConfig.js - shared facade for config, metrics and helper registration

if (typeof StutterConfigStore === 'undefined') {
  throw new Error('stutterConfig.js: StutterConfigStore missing (load order error)');
}
if (typeof StutterMetrics === 'undefined') {
  throw new Error('stutterConfig.js: StutterMetrics missing (load order error)');
}
if (typeof StutterRegistry === 'undefined') {
  throw new Error('stutterConfig.js: StutterRegistry missing (load order error)');
}

// Simple debug flag controlled by env
const DEBUG = Boolean(typeof process !== 'undefined' && (process.env.DEBUG === 'true' || process.env.DEBUG === '1' || process.env.NODE_DEBUG));
function logDebug(...args) { if (DEBUG && typeof console !== 'undefined' && console && typeof console.debug === 'function') console.debug(...args); }

// Expose as a naked global (side-effect require pattern used in this project)
StutterConfig = {
  getConfig: StutterConfigStore.getConfig,
  setConfig: StutterConfigStore.setConfig,
  validateConfig: StutterConfigStore.validateConfig,
  getProfileConfig: StutterConfigStore.getProfileConfig,
  getVelocityRange: StutterConfigStore.getVelocityRange,
  getMetrics: StutterMetrics.getMetrics,
  resetMetrics: StutterMetrics.resetMetrics,
  incScheduled: StutterMetrics.incScheduled,
  incEmitted: StutterMetrics.incEmitted,
  incPendingForTick: StutterMetrics.incPendingForTick,
  decPendingForTick: StutterMetrics.decPendingForTick,
  registerHelper: StutterRegistry.registerHelper,
  getHelper: StutterRegistry.getHelper,
  logDebug,
  DEBUG
};
