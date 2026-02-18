// conductorConfig.js — Conductor profile validation, selection, and access.
// Single authority for the active conductor profile.
// GlobalConductor + DynamismEngine read from ConductorConfig.getActiveProfile()
// instead of using hardcoded constants.

ConductorConfig = (() => {
  /** @type {string} */
  let activeProfileName = 'default';

  /** @type {Object|null} */
  let activeProfileCache = null;

  // ── Schema validation ─────────────────────────────────────────────

  const REQUIRED_DENSITY_KEYS = ['floor', 'ceiling', 'range', 'smoothing'];
  const REQUIRED_STUTTER_KEYS = ['rateTiers', 'coherenceFlip', 'rateCurveFlip'];
  const REQUIRED_ENERGY_KEYS = ['phrase', 'journey', 'feedback', 'pulse'];
  const REQUIRED_FLICKER_KEYS = ['depthScale', 'crossModWeight'];
  const REQUIRED_CLIMAX_KEYS = ['playScale', 'stutterScale'];
  const REQUIRED_TOP_KEYS = ['density', 'phaseMultipliers', 'stutter', 'energyWeights', 'flicker', 'climaxBoost'];

  /**
   * Validate a single conductor profile object.
   * @param {Object} profile
   * @param {string} label
   */
  function validateProfileOrFail(profile, label) {
    if (!profile || typeof profile !== 'object') {
      throw new Error(`ConductorConfig.validateProfileOrFail: ${label} must be an object`);
    }

    for (const key of REQUIRED_TOP_KEYS) {
      if (!profile[key] || typeof profile[key] !== 'object') {
        throw new Error(`ConductorConfig.validateProfileOrFail: ${label}.${key} must be an object`);
      }
    }

    // density
    for (const k of REQUIRED_DENSITY_KEYS) {
      if (profile.density[k] === undefined) throw new Error(`ConductorConfig: ${label}.density.${k} is required`);
    }
    assertFiniteRange(profile.density.floor, 0, 1, `${label}.density.floor`);
    assertFiniteRange(profile.density.ceiling, 0, 1, `${label}.density.ceiling`);
    if (profile.density.floor > profile.density.ceiling) throw new Error(`ConductorConfig: ${label}.density.floor must be <= ceiling`);
    if (!Array.isArray(profile.density.range) || profile.density.range.length !== 2) throw new Error(`ConductorConfig: ${label}.density.range must be [min, max]`);
    assertFiniteRange(profile.density.range[0], 0, 1, `${label}.density.range[0]`);
    assertFiniteRange(profile.density.range[1], 0, 1, `${label}.density.range[1]`);
    assertFiniteRange(profile.density.smoothing, 0, 1, `${label}.density.smoothing`);

    // phaseMultipliers
    if (typeof profile.phaseMultipliers !== 'object') throw new Error(`ConductorConfig: ${label}.phaseMultipliers must be an object`);
    for (const [phase, mult] of Object.entries(profile.phaseMultipliers)) {
      const num = Number(mult);
      if (!Number.isFinite(num) || num < 0 || num > 3) {
        throw new Error(`ConductorConfig: ${label}.phaseMultipliers.${phase} must be finite in [0, 3]`);
      }
    }

    // stutter
    for (const k of REQUIRED_STUTTER_KEYS) {
      if (profile.stutter[k] === undefined) throw new Error(`ConductorConfig: ${label}.stutter.${k} is required`);
    }
    if (!Array.isArray(profile.stutter.rateTiers) || profile.stutter.rateTiers.length === 0) {
      throw new Error(`ConductorConfig: ${label}.stutter.rateTiers must be a non-empty array`);
    }
    for (let i = 0; i < profile.stutter.rateTiers.length; i++) {
      const tier = profile.stutter.rateTiers[i];
      if (!tier || typeof tier !== 'object') throw new Error(`ConductorConfig: ${label}.stutter.rateTiers[${i}] must be an object`);
      assertFiniteRange(tier.threshold, 0, 1, `${label}.stutter.rateTiers[${i}].threshold`);
      if (!Number.isFinite(Number(tier.rate)) || Number(tier.rate) <= 0) throw new Error(`ConductorConfig: ${label}.stutter.rateTiers[${i}].rate must be positive`);
    }
    assertFiniteRange(profile.stutter.coherenceFlip, 0, 1, `${label}.stutter.coherenceFlip`);
    assertFiniteRange(profile.stutter.rateCurveFlip, 0, 1, `${label}.stutter.rateCurveFlip`);

    // energyWeights
    for (const k of REQUIRED_ENERGY_KEYS) {
      if (profile.energyWeights[k] === undefined) throw new Error(`ConductorConfig: ${label}.energyWeights.${k} is required`);
      assertFiniteRange(profile.energyWeights[k], 0, 1, `${label}.energyWeights.${k}`);
    }
    const weightSum = REQUIRED_ENERGY_KEYS.reduce((s, k) => s + Number(profile.energyWeights[k]), 0);
    if (m.abs(weightSum - 1.0) > 0.01) {
      throw new Error(`ConductorConfig: ${label}.energyWeights must sum to 1.0 (got ${weightSum.toFixed(4)})`);
    }

    // flicker
    for (const k of REQUIRED_FLICKER_KEYS) {
      if (profile.flicker[k] === undefined) throw new Error(`ConductorConfig: ${label}.flicker.${k} is required`);
      const num = Number(profile.flicker[k]);
      if (!Number.isFinite(num) || num < 0 || num > 5) {
        throw new Error(`ConductorConfig: ${label}.flicker.${k} must be finite in [0, 5]`);
      }
    }

    // climaxBoost
    for (const k of REQUIRED_CLIMAX_KEYS) {
      if (profile.climaxBoost[k] === undefined) throw new Error(`ConductorConfig: ${label}.climaxBoost.${k} is required`);
      const num = Number(profile.climaxBoost[k]);
      if (!Number.isFinite(num) || num < 0.5 || num > 3) {
        throw new Error(`ConductorConfig: ${label}.climaxBoost.${k} must be finite in [0.5, 3]`);
      }
    }
  }

  /**
   * @param {number} value
   * @param {number} min
   * @param {number} max
   * @param {string} label
   */
  function assertFiniteRange(value, min, max, label) {
    const num = Number(value);
    if (!Number.isFinite(num) || num < min || num > max) {
      throw new Error(`ConductorConfig: ${label} must be finite in [${min}, ${max}]`);
    }
  }

  // ── Profile resolution ────────────────────────────────────────────

  /**
   * Get all validated conductor profiles.
   * @returns {Object}
   */
  function getProfilesOrFail() {
    if (typeof CONDUCTOR_PROFILE_SOURCES === 'undefined' || !CONDUCTOR_PROFILE_SOURCES || typeof CONDUCTOR_PROFILE_SOURCES !== 'object') {
      throw new Error('ConductorConfig.getProfilesOrFail: CONDUCTOR_PROFILE_SOURCES is not available');
    }
    const names = Object.keys(CONDUCTOR_PROFILE_SOURCES);
    if (names.length === 0) throw new Error('ConductorConfig.getProfilesOrFail: no conductor profiles defined');
    for (const name of names) {
      validateProfileOrFail(CONDUCTOR_PROFILE_SOURCES[name], `CONDUCTOR_PROFILE_SOURCES.${name}`);
    }
    return CONDUCTOR_PROFILE_SOURCES;
  }

  /**
   * Get available conductor profile names.
   * @returns {string[]}
   */
  function getProfileNames() {
    return Object.keys(getProfilesOrFail());
  }

  /**
   * Set the active conductor profile by name.
   * @param {string} name
   */
  function setActiveProfile(name) {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('ConductorConfig.setActiveProfile: name must be a non-empty string');
    }
    const profiles = getProfilesOrFail();
    if (!Object.prototype.hasOwnProperty.call(profiles, name)) {
      throw new Error(`ConductorConfig.setActiveProfile: unknown profile "${name}"`);
    }
    activeProfileName = name;
    activeProfileCache = null; // bust cache
  }

  /**
   * Get the active conductor profile (validated, cached).
   * @returns {Object}
   */
  function getActiveProfile() {
    if (activeProfileCache) return activeProfileCache;
    const profiles = getProfilesOrFail();
    const profile = profiles[activeProfileName];
    if (!profile) {
      throw new Error(`ConductorConfig.getActiveProfile: active profile "${activeProfileName}" not found`);
    }
    activeProfileCache = profile;
    return profile;
  }

  /**
   * Get the active profile name.
   * @returns {string}
   */
  function getActiveProfileName() {
    return activeProfileName;
  }

  /**
   * Resolve the phase multiplier for a given section phase string.
   * Falls back to 1.0 for unknown phases.
   * @param {string} sectionPhase
   * @returns {number}
   */
  function getPhaseMultiplier(sectionPhase) {
    const profile = getActiveProfile();
    const mult = profile.phaseMultipliers[sectionPhase];
    return Number.isFinite(Number(mult)) ? Number(mult) : 1.0;
  }

  /**
   * Resolve the stutter rate for a given composite intensity.
   * Walks the rateTiers from highest threshold down.
   * @param {number} compositeIntensity 0-1
   * @returns {{ rate: number, rateCurve: string, coherenceMode: string }}
   */
  function getStutterParams(compositeIntensity) {
    const profile = getActiveProfile();
    const tiers = profile.stutter.rateTiers;

    let rate = tiers[0].rate;
    for (let i = tiers.length - 1; i >= 0; i--) {
      if (compositeIntensity >= tiers[i].threshold) {
        rate = tiers[i].rate;
        break;
      }
    }

    return {
      rate,
      rateCurve: compositeIntensity > profile.stutter.rateCurveFlip ? 'exp' : 'linear',
      coherenceMode: compositeIntensity > profile.stutter.coherenceFlip ? 'loose' : 'tight'
    };
  }

  /**
   * Compute target density from composite intensity using the active profile.
   * @param {number} compositeIntensity 0-1
   * @returns {number}
   */
  function getTargetDensity(compositeIntensity) {
    const profile = getActiveProfile();
    const [lo, hi] = profile.density.range;
    return lo + (hi - lo) * compositeIntensity;
  }

  /**
   * Get the density smoothing coefficient.
   * @returns {number}
   */
  function getDensitySmoothing() {
    return getActiveProfile().density.smoothing;
  }

  /**
   * Get density floor and ceiling for flicker clamping.
   * @returns {{ floor: number, ceiling: number }}
   */
  function getDensityBounds() {
    const p = getActiveProfile();
    return { floor: p.density.floor, ceiling: p.density.ceiling };
  }

  /**
   * Get flicker scaling parameters.
   * @returns {{ depthScale: number, crossModWeight: number }}
   */
  function getFlickerParams() {
    const p = getActiveProfile();
    return { depthScale: p.flicker.depthScale, crossModWeight: p.flicker.crossModWeight };
  }

  /**
   * Get energy weights for DynamismEngine composite calculation.
   * @returns {{ phrase: number, journey: number, feedback: number, pulse: number }}
   */
  function getEnergyWeights() {
    return getActiveProfile().energyWeights;
  }

  /**
   * Get climax boost multipliers.
   * @returns {{ playScale: number, stutterScale: number }}
   */
  function getClimaxBoost() {
    return getActiveProfile().climaxBoost;
  }

  // ── Public API ────────────────────────────────────────────────────

  return {
    getProfilesOrFail,
    getProfileNames,
    setActiveProfile,
    getActiveProfile,
    getActiveProfileName,
    getPhaseMultiplier,
    getStutterParams,
    getTargetDensity,
    getDensitySmoothing,
    getDensityBounds,
    getFlickerParams,
    getEnergyWeights,
    getClimaxBoost,
    validateProfileOrFail
  };
})();
