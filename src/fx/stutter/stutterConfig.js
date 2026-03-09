// stutterConfig.js - config storage and validation

const V = validator.create('stutterConfig');

if (!STUTTER_PROFILES) {
  throw new Error('stutterConfig.js: missing STUTTER_PROFILES global');
}

const STUTTER_REQUIRED_PROFILES = ['source', 'reflection', 'bass'];

const _stutterStore = {
  profiles: Object.assign({}, STUTTER_PROFILES)
};

// Validation caches - these globals are static within a run, so re-validation is redundant.
let _crossModValidated = false;
let _profilesValidated = false;

function assertProfileOrFail(profileName, profileObj) {
  V.assertPlainObject(profileObj, `stutterConfig.profiles.${profileName}`);
  V.assertRange(profileObj.perProb, 0, 1, `stutterConfig.profiles.${profileName}.perProb`);
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
  V.assertPlainObject(value, 'stutterConfig.crossModRules');
  V.assertPlainObject(value.pan, 'stutterConfig.crossModRules.pan');
  V.assertPlainObject(value.fade, 'stutterConfig.crossModRules.fade');
  V.assertPlainObject(value.fx, 'stutterConfig.crossModRules.fx');

  V.assertRange(value.pan.stutterProbScale, 0, 5, 'stutterConfig.crossModRules.pan.stutterProbScale');
  V.assertRange(value.pan.shiftRangeBias, -12, 12, 'stutterConfig.crossModRules.pan.shiftRangeBias');
  V.assertRange(value.pan.stutterRateScale, 0.1, 5, 'stutterConfig.crossModRules.pan.stutterRateScale');
  V.assertRange(value.fade.velocityScaleBias, -1, 2, 'stutterConfig.crossModRules.fade.velocityScaleBias');
  V.assertRange(value.fx.shiftRangeScale, 0.1, 4, 'stutterConfig.crossModRules.fx.shiftRangeScale');
  return value;
}

function assertDirectiveDefaultsOrFail(value) {
  V.assertPlainObject(value, 'stutterConfig.directiveDefaults');
  V.assertPlainObject(value.coherence, 'stutterConfig.directiveDefaults.coherence');
  V.assertBoolean(value.coherence.enabled, 'stutterConfig.directiveDefaults.coherence.enabled');
  V.assertRange(value.coherence.intensity, 0, 1, 'stutterConfig.directiveDefaults.coherence.intensity');
  V.assertNonEmptyString(value.coherence.keyPrefix, 'stutterConfig.directiveDefaults.coherence.keyPrefix');

  V.assertPlainObject(value.phase, 'stutterConfig.directiveDefaults.phase');
  V.assertRange(value.phase.left, 0, 1, 'stutterConfig.directiveDefaults.phase.left');
  V.assertRange(value.phase.right, 0, 1, 'stutterConfig.directiveDefaults.phase.right');
  V.assertRange(value.phase.center, 0, 1, 'stutterConfig.directiveDefaults.phase.center');

  V.assertNonEmptyString(value.rateCurve, 'stutterConfig.directiveDefaults.rateCurve');
  V.assertNonEmptyString(value.phaseCurve, 'stutterConfig.directiveDefaults.phaseCurve');

  V.assertPlainObject(value.perProfileRouting, 'stutterConfig.directiveDefaults.perProfileRouting');
  V.assertNonEmptyString(value.perProfileRouting.L1, 'stutterConfig.directiveDefaults.perProfileRouting.L1');
  V.assertNonEmptyString(value.perProfileRouting.L2, 'stutterConfig.directiveDefaults.perProfileRouting.L2');
  V.assertRange(value.perProfileRouting.defaultWeight, 0, 1, 'stutterConfig.directiveDefaults.perProfileRouting.defaultWeight');

  V.assertPlainObject(value.metricsAdaptive, 'stutterConfig.directiveDefaults.metricsAdaptive');
  V.assertBoolean(value.metricsAdaptive.enabled, 'stutterConfig.directiveDefaults.metricsAdaptive.enabled');
  V.assertRange(value.metricsAdaptive.sensitivity, 0, 1, 'stutterConfig.directiveDefaults.metricsAdaptive.sensitivity');
  return value;
}

function validateConfig() {
  V.assertPlainObject(_stutterStore, 'stutterConfig');
  V.assertPlainObject(_stutterStore.profiles, 'stutterConfig.profiles');
  for (const prof of STUTTER_REQUIRED_PROFILES) {
    if (!_stutterStore.profiles[prof]) {
      throw new Error(`stutterConfig.validateConfig: missing required profile "${prof}"`);
    }
    assertProfileOrFail(prof, _stutterStore.profiles[prof]);
  }
  return _stutterStore;
}

function getConfig() { return validateConfig(); }
function setConfig(partial = {}) {
  V.assertPlainObject(partial, 'stutterConfig.setConfig.partial');
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
    throw new Error(`stutterConfig.getProfileConfig: unknown profile "${profileName}"`);
  }
  return _stutterStore.profiles[profileName];
}

function getVelocityRange(profile = 'source', isPrimary = true) {
  if (!STUTTER_VELOCITY_RANGES) {
    throw new Error('stutterConfig.getVelocityRange: STUTTER_VELOCITY_RANGES global not found');
  }
  const profileName = String(profile);
  const ranges = STUTTER_VELOCITY_RANGES[profileName];
  V.assertObject(ranges, 'ranges');
  const key = isPrimary ? 'primary' : 'secondary';
  return assertVelocityPairOrFail(ranges[key], `stutterConfig.velocityRanges.${profileName}.${key}`);
}
function getCrossModRules() {
  if (!STUTTER_CROSSMOD_RULES) {
    throw new Error('stutterConfig.getCrossModRules: STUTTER_CROSSMOD_RULES global is not defined');
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
    throw new Error('stutterConfig.getDirectiveDefaults: STUTTER_DIRECTIVE_DEFAULTS global is required');
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

stutterConfig = {
  getConfig,
  setConfig,
  validateConfig,
  getProfileConfig,
  getVelocityRange,
  getCrossModRules,
  getPreset,
  getDirectiveDefaults
};
