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
};
