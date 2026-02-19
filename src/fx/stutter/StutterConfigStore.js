// StutterConfigStore.js - config storage and validation
// Exports the StutterConfig global directly (no wrapper needed).

if (typeof STUTTER_PROFILES === 'undefined') {
  throw new Error('StutterConfigStore.js: missing STUTTER_PROFILES global');
}

const _stutterStore = {
  profiles: Object.assign({}, STUTTER_PROFILES)
};

function _clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return m.max(0, m.min(1, n));
}

function validateConfig() {
  if (!_stutterStore.profiles) _stutterStore.profiles = Object.assign({}, STUTTER_PROFILES);
  for (const prof of ['source', 'reflection', 'bass']) {
    if (!_stutterStore.profiles[prof]) _stutterStore.profiles[prof] = { perProb: 0 };
    if (typeof _stutterStore.profiles[prof].perProb !== 'number') _stutterStore.profiles[prof].perProb = 0;
    _stutterStore.profiles[prof].perProb = _clamp01(_stutterStore.profiles[prof].perProb);
  }
  return _stutterStore;
}

function getConfig() { return validateConfig(); }
function setConfig(partial = {}) { Object.assign(_stutterStore, partial); return validateConfig(); }
function getProfileConfig(profile = 'source') {
  validateConfig();
  return _stutterStore.profiles[profile] || _stutterStore.profiles.source;
}

function getVelocityRange(profile = 'source', isPrimary = true) {
  if (!STUTTER_VELOCITY_RANGES) {
    throw new Error('[StutterConfig] STUTTER_VELOCITY_RANGES global not found.');
  }
  const ranges = STUTTER_VELOCITY_RANGES[profile] || STUTTER_VELOCITY_RANGES.source;
  return isPrimary ? ranges.primary : ranges.secondary;
}
function getCrossModRules() {
  if (typeof STUTTER_CROSSMOD_RULES === 'undefined') {
    if (typeof STUTTER_CROSSMOD_RULES_FALLBACK !== 'undefined' && STUTTER_CROSSMOD_RULES_FALLBACK && typeof STUTTER_CROSSMOD_RULES_FALLBACK === 'object') {
      return STUTTER_CROSSMOD_RULES_FALLBACK;
    }
    return {
      pan: { stutterProbScale: 1.0, shiftRangeBias: 0, stutterRateScale: 1.0 },
      fade: { velocityScaleBias: 0 },
      fx: { shiftRangeScale: 1.0 }
    };
  }
  return STUTTER_CROSSMOD_RULES;
}

function getPreset(name = 'default') {
  if (typeof STUTTER_PRESETS === 'undefined') return null;
  return (STUTTER_PRESETS && STUTTER_PRESETS[name]) ? STUTTER_PRESETS[name] : null;
}

function getDirectiveDefaults() {
  const fallback = {
    coherence: { enabled: false, intensity: 0.8, keyPrefix: 'stutter' },
    phase: { left: 0, right: 0.5, center: 0 },
    rateCurve: 'linear',
    phaseCurve: 'linear',
    crossModOverrides: null,
    perProfileRouting: { L1: 'source', L2: 'reflection', defaultWeight: 0.6 },
    metricsAdaptive: { enabled: false, sensitivity: 0.08 }
  };
  const source = (typeof STUTTER_DIRECTIVE_DEFAULTS !== 'undefined' && STUTTER_DIRECTIVE_DEFAULTS && typeof STUTTER_DIRECTIVE_DEFAULTS === 'object')
    ? STUTTER_DIRECTIVE_DEFAULTS
    : fallback;
  return {
    coherence: Object.assign({}, fallback.coherence, source.coherence || {}),
    phase: Object.assign({}, fallback.phase, source.phase || {}),
    rateCurve: typeof source.rateCurve === 'string' ? source.rateCurve : fallback.rateCurve,
    phaseCurve: typeof source.phaseCurve === 'string' ? source.phaseCurve : fallback.phaseCurve,
    crossModOverrides: Object.prototype.hasOwnProperty.call(source, 'crossModOverrides') ? source.crossModOverrides : fallback.crossModOverrides,
    perProfileRouting: Object.assign({}, fallback.perProfileRouting, source.perProfileRouting || {}),
    metricsAdaptive: Object.assign({}, fallback.metricsAdaptive, source.metricsAdaptive || {})
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
