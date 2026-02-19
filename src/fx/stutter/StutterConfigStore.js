// StutterConfigStore.js - config storage and validation
// Exports the StutterConfig global directly (no wrapper needed).

const VC = Validator.create('StutterConfigStore');

if (typeof STUTTER_PROFILES === 'undefined') {
  throw new Error('StutterConfigStore.js: missing STUTTER_PROFILES global');
}

const STUTTER_REQUIRED_PROFILES = ['source', 'reflection', 'bass'];

const _stutterStore = {
  profiles: Object.assign({}, STUTTER_PROFILES)
};

function assertProfileOrFail(profileName, profileObj) {
  VC.assertPlainObject(profileObj, `StutterConfig.profiles.${profileName}`);
  VC.assertRange(profileObj.perProb, 0, 1, `StutterConfig.profiles.${profileName}.perProb`);
}

function assertVelocityPairOrFail(value, label) {
  const pair = VC.assertArrayLength(value, 2, label);
  const min = VC.assertRange(pair[0], 0, 1, `${label}[0]`);
  const max = VC.assertRange(pair[1], 0, 1, `${label}[1]`);
  if (max < min) {
    throw new Error(`${label}[1] must be >= ${label}[0]`);
  }
  return [min, max];
}

function assertCrossModRulesOrFail(value) {
  VC.assertPlainObject(value, 'StutterConfig.crossModRules');
  VC.assertPlainObject(value.pan, 'StutterConfig.crossModRules.pan');
  VC.assertPlainObject(value.fade, 'StutterConfig.crossModRules.fade');
  VC.assertPlainObject(value.fx, 'StutterConfig.crossModRules.fx');

  VC.assertRange(value.pan.stutterProbScale, 0, 5, 'StutterConfig.crossModRules.pan.stutterProbScale');
  VC.assertRange(value.pan.shiftRangeBias, -12, 12, 'StutterConfig.crossModRules.pan.shiftRangeBias');
  VC.assertRange(value.pan.stutterRateScale, 0.1, 5, 'StutterConfig.crossModRules.pan.stutterRateScale');
  VC.assertRange(value.fade.velocityScaleBias, -1, 2, 'StutterConfig.crossModRules.fade.velocityScaleBias');
  VC.assertRange(value.fx.shiftRangeScale, 0.1, 4, 'StutterConfig.crossModRules.fx.shiftRangeScale');
  return value;
}

function assertDirectiveDefaultsOrFail(value) {
  VC.assertPlainObject(value, 'StutterConfig.directiveDefaults');
  VC.assertPlainObject(value.coherence, 'StutterConfig.directiveDefaults.coherence');
  VC.assertBoolean(value.coherence.enabled, 'StutterConfig.directiveDefaults.coherence.enabled');
  VC.assertRange(value.coherence.intensity, 0, 1, 'StutterConfig.directiveDefaults.coherence.intensity');
  VC.assertNonEmptyString(value.coherence.keyPrefix, 'StutterConfig.directiveDefaults.coherence.keyPrefix');

  VC.assertPlainObject(value.phase, 'StutterConfig.directiveDefaults.phase');
  VC.assertRange(value.phase.left, 0, 1, 'StutterConfig.directiveDefaults.phase.left');
  VC.assertRange(value.phase.right, 0, 1, 'StutterConfig.directiveDefaults.phase.right');
  VC.assertRange(value.phase.center, 0, 1, 'StutterConfig.directiveDefaults.phase.center');

  VC.assertNonEmptyString(value.rateCurve, 'StutterConfig.directiveDefaults.rateCurve');
  VC.assertNonEmptyString(value.phaseCurve, 'StutterConfig.directiveDefaults.phaseCurve');

  VC.assertPlainObject(value.perProfileRouting, 'StutterConfig.directiveDefaults.perProfileRouting');
  VC.assertNonEmptyString(value.perProfileRouting.L1, 'StutterConfig.directiveDefaults.perProfileRouting.L1');
  VC.assertNonEmptyString(value.perProfileRouting.L2, 'StutterConfig.directiveDefaults.perProfileRouting.L2');
  VC.assertRange(value.perProfileRouting.defaultWeight, 0, 1, 'StutterConfig.directiveDefaults.perProfileRouting.defaultWeight');

  VC.assertPlainObject(value.metricsAdaptive, 'StutterConfig.directiveDefaults.metricsAdaptive');
  VC.assertBoolean(value.metricsAdaptive.enabled, 'StutterConfig.directiveDefaults.metricsAdaptive.enabled');
  VC.assertRange(value.metricsAdaptive.sensitivity, 0, 1, 'StutterConfig.directiveDefaults.metricsAdaptive.sensitivity');
  return value;
}

function validateConfig() {
  VC.assertPlainObject(_stutterStore, 'StutterConfigStore');
  VC.assertPlainObject(_stutterStore.profiles, 'StutterConfigStore.profiles');
  for (const prof of STUTTER_REQUIRED_PROFILES) {
    if (!_stutterStore.profiles[prof]) {
      throw new Error(`StutterConfigStore.validateConfig: missing required profile "${prof}"`);
    }
    assertProfileOrFail(prof, _stutterStore.profiles[prof]);
  }
  return _stutterStore;
}

function getConfig() { return validateConfig(); }
function setConfig(partial = {}) {
  VC.assertPlainObject(partial, 'StutterConfigStore.setConfig.partial');
  Object.assign(_stutterStore, partial);
  return validateConfig();
}
function getProfileConfig(profile = 'source') {
  validateConfig();
  const profileName = String(profile);
  if (!_stutterStore.profiles[profileName]) {
    throw new Error(`StutterConfigStore.getProfileConfig: unknown profile "${profileName}"`);
  }
  return _stutterStore.profiles[profileName];
}

function getVelocityRange(profile = 'source', isPrimary = true) {
  if (typeof STUTTER_VELOCITY_RANGES === 'undefined' || !STUTTER_VELOCITY_RANGES || typeof STUTTER_VELOCITY_RANGES !== 'object') {
    throw new Error('StutterConfigStore.getVelocityRange: STUTTER_VELOCITY_RANGES global not found');
  }
  const profileName = String(profile);
  const ranges = STUTTER_VELOCITY_RANGES[profileName];
  if (!ranges || typeof ranges !== 'object') {
    throw new Error(`StutterConfigStore.getVelocityRange: missing velocity ranges for profile "${profileName}"`);
  }
  const key = isPrimary ? 'primary' : 'secondary';
  return assertVelocityPairOrFail(ranges[key], `StutterConfig.velocityRanges.${profileName}.${key}`);
}
function getCrossModRules() {
  if (typeof STUTTER_CROSSMOD_RULES === 'undefined') {
    throw new Error('StutterConfigStore.getCrossModRules: STUTTER_CROSSMOD_RULES global is not defined');
  }
  return assertCrossModRulesOrFail(STUTTER_CROSSMOD_RULES);
}

function getPreset(name = 'default') {
  if (typeof STUTTER_PRESETS === 'undefined') return null;
  return (STUTTER_PRESETS && STUTTER_PRESETS[name]) ? STUTTER_PRESETS[name] : null;
}

function getDirectiveDefaults() {
  if (typeof STUTTER_DIRECTIVE_DEFAULTS === 'undefined' || !STUTTER_DIRECTIVE_DEFAULTS || typeof STUTTER_DIRECTIVE_DEFAULTS !== 'object') {
    throw new Error('StutterConfigStore.getDirectiveDefaults: STUTTER_DIRECTIVE_DEFAULTS global is required');
  }
  const defaults = assertDirectiveDefaultsOrFail(STUTTER_DIRECTIVE_DEFAULTS);
  return {
    coherence: Object.assign({}, defaults.coherence),
    phase: Object.assign({}, defaults.phase),
    rateCurve: defaults.rateCurve,
    phaseCurve: defaults.phaseCurve,
    crossModOverrides: Object.prototype.hasOwnProperty.call(defaults, 'crossModOverrides') ? defaults.crossModOverrides : null,
    perProfileRouting: Object.assign({}, defaults.perProfileRouting),
    metricsAdaptive: Object.assign({}, defaults.metricsAdaptive)
  };
}

StutterConfigStore = {
  getConfig,
  setConfig,
  validateConfig,
  getProfileConfig,
  getVelocityRange,
  getCrossModRules,
  getPreset,
  getDirectiveDefaults
};// Assign directly as StutterConfig (replaces the old StutterConfigStore + stutterConfig double)
StutterConfig = {
  getConfig,
  setConfig,
  validateConfig,
  getProfileConfig,
  getVelocityRange,
  getCrossModRules,
  getPreset,
  getDirectiveDefaults
};
