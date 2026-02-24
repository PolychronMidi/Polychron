// StutterConfigStore.js - config storage and validation
// Exports the StutterConfig global directly (no wrapper needed).

const V = Validator.create('stutterConfigStore');

if (!STUTTER_PROFILES) {
  throw new Error('StutterConfigStore.js: missing STUTTER_PROFILES global');
}

const STUTTER_REQUIRED_PROFILES = ['source', 'reflection', 'bass'];

const _stutterStore = {
  profiles: Object.assign({}, STUTTER_PROFILES)
};

// Validation caches â€” these globals are static within a run, so re-validation is redundant.
let _crossModValidated = false;
let _profilesValidated = false;

function assertProfileOrFail(profileName, profileObj) {
  V.assertPlainObject(profileObj, `StutterConfig.profiles.${profileName}`);
  V.assertRange(profileObj.perProb, 0, 1, `StutterConfig.profiles.${profileName}.perProb`);
}

function assertVelocityPairOrFail(value, label) {
  const pair = V.assertArrayLength(value, 2, label);
  const min = V.assertRange(pair[0], 0, 1, `${label}[0]`);
  const max = V.assertRange(pair[1], 0, 1, `${label}[1]`);
  if (max < min) {
    throw new Error(`${label}[1] must be >= ${label}[0]`);
  }
  return [min, max];
}

function assertCrossModRulesOrFail(value) {
  V.assertPlainObject(value, 'StutterConfig.crossModRules');
  V.assertPlainObject(value.pan, 'StutterConfig.crossModRules.pan');
  V.assertPlainObject(value.fade, 'StutterConfig.crossModRules.fade');
  V.assertPlainObject(value.fx, 'StutterConfig.crossModRules.fx');

  V.assertRange(value.pan.stutterProbScale, 0, 5, 'StutterConfig.crossModRules.pan.stutterProbScale');
  V.assertRange(value.pan.shiftRangeBias, -12, 12, 'StutterConfig.crossModRules.pan.shiftRangeBias');
  V.assertRange(value.pan.stutterRateScale, 0.1, 5, 'StutterConfig.crossModRules.pan.stutterRateScale');
  V.assertRange(value.fade.velocityScaleBias, -1, 2, 'StutterConfig.crossModRules.fade.velocityScaleBias');
  V.assertRange(value.fx.shiftRangeScale, 0.1, 4, 'StutterConfig.crossModRules.fx.shiftRangeScale');
  return value;
}

function assertDirectiveDefaultsOrFail(value) {
  V.assertPlainObject(value, 'StutterConfig.directiveDefaults');
  V.assertPlainObject(value.coherence, 'StutterConfig.directiveDefaults.coherence');
  V.assertBoolean(value.coherence.enabled, 'StutterConfig.directiveDefaults.coherence.enabled');
  V.assertRange(value.coherence.intensity, 0, 1, 'StutterConfig.directiveDefaults.coherence.intensity');
  V.assertNonEmptyString(value.coherence.keyPrefix, 'StutterConfig.directiveDefaults.coherence.keyPrefix');

  V.assertPlainObject(value.phase, 'StutterConfig.directiveDefaults.phase');
  V.assertRange(value.phase.left, 0, 1, 'StutterConfig.directiveDefaults.phase.left');
  V.assertRange(value.phase.right, 0, 1, 'StutterConfig.directiveDefaults.phase.right');
  V.assertRange(value.phase.center, 0, 1, 'StutterConfig.directiveDefaults.phase.center');

  V.assertNonEmptyString(value.rateCurve, 'StutterConfig.directiveDefaults.rateCurve');
  V.assertNonEmptyString(value.phaseCurve, 'StutterConfig.directiveDefaults.phaseCurve');

  V.assertPlainObject(value.perProfileRouting, 'StutterConfig.directiveDefaults.perProfileRouting');
  V.assertNonEmptyString(value.perProfileRouting.L1, 'StutterConfig.directiveDefaults.perProfileRouting.L1');
  V.assertNonEmptyString(value.perProfileRouting.L2, 'StutterConfig.directiveDefaults.perProfileRouting.L2');
  V.assertRange(value.perProfileRouting.defaultWeight, 0, 1, 'StutterConfig.directiveDefaults.perProfileRouting.defaultWeight');

  V.assertPlainObject(value.metricsAdaptive, 'StutterConfig.directiveDefaults.metricsAdaptive');
  V.assertBoolean(value.metricsAdaptive.enabled, 'StutterConfig.directiveDefaults.metricsAdaptive.enabled');
  V.assertRange(value.metricsAdaptive.sensitivity, 0, 1, 'StutterConfig.directiveDefaults.metricsAdaptive.sensitivity');
  return value;
}

function validateConfig() {
  V.assertPlainObject(_stutterStore, 'StutterConfigStore');
  V.assertPlainObject(_stutterStore.profiles, 'StutterConfigStore.profiles');
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
  V.assertPlainObject(partial, 'StutterConfigStore.setConfig.partial');
  Object.assign(_stutterStore, partial);
  _profilesValidated = false;
  return validateConfig();
}
function getProfileConfig(profile = 'source') {
  if (!_profilesValidated) {
    validateConfig();
    _profilesValidated = true;
  }
  const profileName = String(profile);
  if (!_stutterStore.profiles[profileName]) {
    throw new Error(`StutterConfigStore.getProfileConfig: unknown profile "${profileName}"`);
  }
  return _stutterStore.profiles[profileName];
}

function getVelocityRange(profile = 'source', isPrimary = true) {
  if (!STUTTER_VELOCITY_RANGES) {
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
  if (!STUTTER_CROSSMOD_RULES) {
    throw new Error('StutterConfigStore.getCrossModRules: STUTTER_CROSSMOD_RULES global is not defined');
  }
  if (_crossModValidated) return STUTTER_CROSSMOD_RULES;
  const result = assertCrossModRulesOrFail(STUTTER_CROSSMOD_RULES);
  _crossModValidated = true;
  return result;
}

function getPreset(name = 'default') {
  if (!STUTTER_PRESETS) return null;
  return (STUTTER_PRESETS && STUTTER_PRESETS[name]) ? STUTTER_PRESETS[name] : null;
}

function getDirectiveDefaults() {
  if (!STUTTER_DIRECTIVE_DEFAULTS) {
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

