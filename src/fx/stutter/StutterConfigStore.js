// StutterConfigStore.js - config storage and validation

// Default tuning configuration (sourced from config.js globals)
if (typeof STUTTER_PROBABILITIES === 'undefined' || typeof STUTTER_PROFILES === 'undefined') {
  throw new Error('StutterConfigStore.js: missing STUTTER_PROBABILITIES or STUTTER_PROFILES globals');
}
const DEFAULT_PROBABILITIES = STUTTER_PROBABILITIES;
const DEFAULT_PROFILES = STUTTER_PROFILES;

const stutterConfigStore = {
  probabilities: Object.assign({}, DEFAULT_PROBABILITIES),
  profiles: Object.assign({}, DEFAULT_PROFILES)
};

function _clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return m.max(0, m.min(1, n));
}

function validateConfig() {
  if (!stutterConfigStore.probabilities) stutterConfigStore.probabilities = Object.assign({}, DEFAULT_PROBABILITIES);
  if (!stutterConfigStore.profiles) stutterConfigStore.profiles = Object.assign({}, DEFAULT_PROFILES);

  if (typeof stutterConfigStore.probabilities.globalApplyProb !== 'number') stutterConfigStore.probabilities.globalApplyProb = 0.2;
  stutterConfigStore.probabilities.globalApplyProb = _clamp01(stutterConfigStore.probabilities.globalApplyProb);

  const profiles = ['source', 'reflection', 'bass'];
  for (const prof of profiles) {
    const fallback = (stutterConfigStore.probabilities.perProb && Number.isFinite(stutterConfigStore.probabilities.perProb[prof]))
      ? stutterConfigStore.probabilities.perProb[prof]
      : 0;
    const fallbackShift = (stutterConfigStore.probabilities.shiftProb && Number.isFinite(stutterConfigStore.probabilities.shiftProb[prof]))
      ? stutterConfigStore.probabilities.shiftProb[prof]
      : 0;

    if (!stutterConfigStore.profiles[prof]) stutterConfigStore.profiles[prof] = { perProb: fallback, shiftProb: fallbackShift };
    if (typeof stutterConfigStore.profiles[prof].perProb !== 'number') stutterConfigStore.profiles[prof].perProb = fallback;
    if (typeof stutterConfigStore.profiles[prof].shiftProb !== 'number') stutterConfigStore.profiles[prof].shiftProb = fallbackShift;
    stutterConfigStore.profiles[prof].perProb = _clamp01(stutterConfigStore.profiles[prof].perProb);
    stutterConfigStore.profiles[prof].shiftProb = _clamp01(stutterConfigStore.profiles[prof].shiftProb);
  }

  return stutterConfigStore;
}

function getConfig() { return validateConfig(); }
function setConfig(partial = {}) { Object.assign(stutterConfigStore, partial); return validateConfig(); }
function getProfileConfig(profile = 'source') {
  validateConfig();
  return stutterConfigStore.profiles[profile] || stutterConfigStore.profiles.source;
}

function getVelocityRange(profile = 'source', isPrimary = true) {
  if (!STUTTER_VELOCITY_RANGES) {
    throw new Error('[StutterConfigStore] STUTTER_VELOCITY_RANGES global not found.');
  }
  const ranges = STUTTER_VELOCITY_RANGES[profile] || STUTTER_VELOCITY_RANGES.source;
  return isPrimary ? ranges.primary : ranges.secondary;
}

StutterConfigStore = {
  getConfig,
  setConfig,
  validateConfig,
  getProfileConfig,
  getVelocityRange
};
