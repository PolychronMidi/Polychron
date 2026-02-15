// stutterConfig.js - shared facade for config access

if (typeof StutterConfigStore === 'undefined') {
  throw new Error('stutterConfig.js: StutterConfigStore missing (load order error)');
}

StutterConfig = {
  getConfig: StutterConfigStore.getConfig,
  setConfig: StutterConfigStore.setConfig,
  validateConfig: StutterConfigStore.validateConfig,
  getProfileConfig: StutterConfigStore.getProfileConfig,
  getVelocityRange: StutterConfigStore.getVelocityRange,
};
