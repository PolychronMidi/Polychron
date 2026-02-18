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
  const REQUIRED_CROSSMOD_KEYS = ['rangeScale', 'penaltyScale', 'textureBoostScale'];
  const REQUIRED_FXMIX_KEYS = ['reverbScale', 'filterOpenness', 'delayScale', 'textureBoostScale'];
  const REQUIRED_TOP_KEYS = ['density', 'phaseMultipliers', 'stutter', 'energyWeights', 'flicker', 'climaxBoost', 'crossMod', 'fxMix'];

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

    // crossMod
    for (const k of REQUIRED_CROSSMOD_KEYS) {
      if (profile.crossMod[k] === undefined) throw new Error(`ConductorConfig: ${label}.crossMod.${k} is required`);
      assertFiniteRange(profile.crossMod[k], 0, 5, `${label}.crossMod.${k}`);
    }

    // fxMix
    for (const k of REQUIRED_FXMIX_KEYS) {
      if (profile.fxMix[k] === undefined) throw new Error(`ConductorConfig: ${label}.fxMix.${k} is required`);
      assertFiniteRange(profile.fxMix[k], 0, 5, `${label}.fxMix.${k}`);
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
    const profile = resolveField('phaseMultipliers');
    const mult = profile[sectionPhase];
    return Number.isFinite(Number(mult)) ? Number(mult) : 1.0;
  }

  /**
   * Resolve the stutter rate for a given composite intensity.
   * Walks the rateTiers from highest threshold down.
   * @param {number} compositeIntensity 0-1
   * @returns {{ rate: number, rateCurve: string, coherenceMode: string }}
   */
  function getStutterParams(compositeIntensity) {
    const stutterProfile = resolveField('stutter');
    const tiers = stutterProfile.rateTiers;

    let rate = tiers[0].rate;
    for (let i = tiers.length - 1; i >= 0; i--) {
      if (compositeIntensity >= tiers[i].threshold) {
        rate = tiers[i].rate;
        break;
      }
    }

    return {
      rate,
      rateCurve: compositeIntensity > stutterProfile.rateCurveFlip ? 'exp' : 'linear',
      coherenceMode: compositeIntensity > stutterProfile.coherenceFlip ? 'loose' : 'tight'
    };
  }

  /**
   * Get the density smoothing coefficient.
   * @returns {number}
   */
  function getDensitySmoothing() {
    return resolveField('density').smoothing;
  }

  /**
   * Get density floor and ceiling for flicker clamping.
   * @returns {{ floor: number, ceiling: number }}
   */
  function getDensityBounds() {
    const p = resolveField('density');
    return { floor: p.floor, ceiling: p.ceiling };
  }

  /**
   * Get flicker scaling parameters.
   * @returns {{ depthScale: number, crossModWeight: number }}
   */
  function getFlickerParams() {
    const p = resolveField('flicker');
    return { depthScale: p.depthScale, crossModWeight: p.crossModWeight };
  }

  /**
   * Get energy weights for DynamismEngine composite calculation.
   * @returns {{ phrase: number, journey: number, feedback: number, pulse: number }}
   */
  function getEnergyWeights() {
    return resolveField('energyWeights');
  }

  /**
   * Get climax boost multipliers.
   * @returns {{ playScale: number, stutterScale: number }}
   */
  function getClimaxBoost() {
    return resolveField('climaxBoost');
  }

  /**
   * Get crossMod scaling parameters.
   * @returns {{ rangeScale: number, penaltyScale: number, textureBoostScale: number }}
   */
  function getCrossModScaling() {
    return resolveField('crossMod');
  }

  /**
   * Get FX mix scaling parameters.
   * @returns {{ reverbScale: number, filterOpenness: number, delayScale: number, textureBoostScale: number }}
   */
  function getFxMixScaling() {
    return resolveField('fxMix');
  }

  // ── Profile crossfading ───────────────────────────────────────────
  // When transitioning between sections, the conductor smoothly
  // interpolates between outgoing and incoming profiles over a
  // configurable number of measures so the change feels organic.

  /** @type {{ from: Object|null, to: Object|null, measuresTotal: number, measuresCurrent: number, active: boolean }} */
  const _crossfade = {
    from: null,
    to: null,
    measuresTotal: 4,  // default: blend over 4 measures
    measuresCurrent: 0,
    active: false
  };

  /**
   * Resolve a top-level profile field, applying crossfade blending if active.
   * Numeric leaf values are linearly interpolated; non-numeric values snap to target.
   * @param {string} field - top-level key (e.g. 'density', 'crossMod')
   * @returns {Object}
   */
  function resolveField(field) {
    const target = getActiveProfile()[field];
    if (!_crossfade.active || !_crossfade.from) return target;

    const t = m.min(_crossfade.measuresCurrent / m.max(_crossfade.measuresTotal, 1), 1);
    if (t >= 1) return target; // crossfade complete

    const fromVal = _crossfade.from[field];
    if (!fromVal || typeof fromVal !== 'object') return target;

    return lerpObject(fromVal, target, t);
  }

  /**
   * Deep-lerp two objects with matching structure. Numeric leaves are
   * interpolated; arrays are element-wise; non-numeric leaves snap to `b`.
   * @param {Object} a - source object
   * @param {Object} b - target object
   * @param {number} t - blend factor 0..1
   * @returns {Object}
   */
  function lerpObject(a, b, t) {
    const result = {};
    for (const key of Object.keys(b)) {
      const av = a[key];
      const bv = b[key];
      if (typeof bv === 'number' && typeof av === 'number') {
        result[key] = av + (bv - av) * t;
      } else if (Array.isArray(bv) && Array.isArray(av) && av.length === bv.length) {
        result[key] = bv.map((v, i) => typeof v === 'number' && typeof av[i] === 'number' ? av[i] + (v - av[i]) * t : v);
      } else if (bv && typeof bv === 'object' && !Array.isArray(bv) && av && typeof av === 'object') {
        result[key] = lerpObject(av, bv, t);
      } else {
        result[key] = bv;
      }
    }
    return result;
  }

  /**
   * Advance the crossfade by one measure. Call from the main loop at
   * the top of each measure.
   */
  function tickCrossfade() {
    if (!_crossfade.active) return;
    _crossfade.measuresCurrent++;
    if (_crossfade.measuresCurrent >= _crossfade.measuresTotal) {
      _crossfade.active = false;
      _crossfade.from = null;
    }
  }

  // ── Self-regulation feedback ──────────────────────────────────────
  // Monitors rolling composite intensity via crossModulation (from
  // crossModulateRhythms) and microUnitAttenuator survivor counts.
  // When density stays too high or too low for too long, the conductor
  // auto-nudges toward a corrective profile by blending a bias into
  // the active profile's density and crossMod fields.

  const _regulation = {
    /** Rolling window of recent compositeIntensity samples */
    window: /** @type {number[]} */ ([]),
    windowSize: 16,           // samples (measures)
    highThreshold: 0.78,      // sustained intensity above this → compress
    lowThreshold: 0.25,       // sustained intensity below this → boost
    /** Current bias applied on top of the active profile (additive for density range, multiplicative for crossMod) */
    densityBias: 0,
    crossModBias: 1.0,
    /** Maximum strength of auto-correction (prevents runaway feedback) */
    maxDensityBias: 0.12,
    maxCrossModBias: 0.3,
    /** Rate of bias adjustment per measure */
    adjustRate: 0.02
  };

  /**
   * Feed the self-regulation system with the current composite intensity.
   * Uses crossModulation (from crossModulateRhythms) clamped to 0-1 as
   * the density proxy, exactly how the existing pipeline measures density.
   * Call once per measure from the main loop.
   */
  function regulationTick() {
    // Sample intensity from the real crossMod/attenuator pipeline
    const crossModSample = (typeof crossModulation === 'number' && Number.isFinite(crossModulation))
      ? clamp(crossModulation / 6, 0, 1) // normalize the ~0-6 crossMod range to 0-1
      : 0.5;

    _regulation.window.push(crossModSample);
    if (_regulation.window.length > _regulation.windowSize) {
      _regulation.window.shift();
    }

    // Need enough samples to make a judgment
    if (_regulation.window.length < _regulation.windowSize * 0.5) return;

    const avg = _regulation.window.reduce((s, v) => s + v, 0) / _regulation.window.length;

    if (avg > _regulation.highThreshold) {
      // Too dense for too long → compress density upward bound, tighten crossMod
      _regulation.densityBias = clamp(
        _regulation.densityBias - _regulation.adjustRate,
        -_regulation.maxDensityBias,
        _regulation.maxDensityBias
      );
      _regulation.crossModBias = clamp(
        _regulation.crossModBias - _regulation.adjustRate * 0.5,
        1 - _regulation.maxCrossModBias,
        1 + _regulation.maxCrossModBias
      );
    } else if (avg < _regulation.lowThreshold) {
      // Too sparse for too long → push density upward, widen crossMod
      _regulation.densityBias = clamp(
        _regulation.densityBias + _regulation.adjustRate,
        -_regulation.maxDensityBias,
        _regulation.maxDensityBias
      );
      _regulation.crossModBias = clamp(
        _regulation.crossModBias + _regulation.adjustRate * 0.5,
        1 - _regulation.maxCrossModBias,
        1 + _regulation.maxCrossModBias
      );
    } else {
      // In the sweet spot → decay bias toward zero
      _regulation.densityBias *= 0.9;
      _regulation.crossModBias = 1 + (_regulation.crossModBias - 1) * 0.9;
    }
  }

  /**
   * Get the current self-regulation bias for density.
   * @returns {number} additive bias for density range endpoints
   */
  function getRegulationDensityBias() {
    return _regulation.densityBias;
  }

  /**
   * Get the current self-regulation bias for crossMod scaling.
   * @returns {number} multiplicative bias on crossMod rangeScale
   */
  function getRegulationCrossModBias() {
    return _regulation.crossModBias;
  }

  /**
   * Compute target density from composite intensity using the active profile,
   * with crossfade blending and self-regulation bias applied.
   * @param {number} compositeIntensity 0-1
   * @returns {number}
   */
  function getTargetDensityRegulated(compositeIntensity) {
    const densityProfile = resolveField('density');
    const [lo, hi] = densityProfile.range;
    const biasedLo = clamp(lo + _regulation.densityBias, 0, 1);
    const biasedHi = clamp(hi + _regulation.densityBias, 0, 1);
    return biasedLo + (biasedHi - biasedLo) * compositeIntensity;
  }

  // ── Phase-driven profile selection ────────────────────────────────

  /**
   * Mapping from structural phase → conductor profile name.
   * Each phase picks the profile whose character best serves the musical moment.
   */
  const PHASE_PROFILE_MAP = {
    intro:       'restrained',
    opening:     'restrained',
    exposition:  'default',
    development: 'default',
    climax:      'explosive',
    resolution:  'atmospheric',
    conclusion:  'atmospheric',
    coda:        'minimal'
  };

  /**
   * Select and activate the conductor profile that matches the current
   * structural phase read from HarmonicContext.
   * Initiates a crossfade from the previous profile over N measures.
   * Call once at the top of each section (after HarmonicJourney.applyToContext).
   * @param {{ crossfadeMeasures?: number }} [opts]
   * @returns {string} the profile name that was activated
   */
  function applyPhaseProfile(opts = {}) {
    const phase = (typeof HarmonicContext !== 'undefined' && HarmonicContext && typeof HarmonicContext.getField === 'function')
      ? (HarmonicContext.getField('sectionPhase') || 'development')
      : 'development';

    const profileName = PHASE_PROFILE_MAP[phase] || 'default';

    // Snapshot the outgoing profile before switching
    const outgoing = activeProfileCache || getActiveProfile();
    const outgoingName = activeProfileName;

    setActiveProfile(profileName);

    // Initiate crossfade if the profile actually changed
    if (outgoingName !== profileName) {
      _crossfade.from = outgoing;
      _crossfade.to = getActiveProfile();
      _crossfade.measuresTotal = (opts.crossfadeMeasures && Number.isFinite(opts.crossfadeMeasures))
        ? m.max(1, opts.crossfadeMeasures)
        : 4;
      _crossfade.measuresCurrent = 0;
      _crossfade.active = true;
    }

    return profileName;
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
    getTargetDensity: getTargetDensityRegulated,
    getDensitySmoothing,
    getDensityBounds,
    getFlickerParams,
    getEnergyWeights,
    getClimaxBoost,
    getCrossModScaling,
    getFxMixScaling,
    applyPhaseProfile,
    tickCrossfade,
    regulationTick,
    getRegulationDensityBias,
    getRegulationCrossModBias,
    validateProfileOrFail
  };
})();
