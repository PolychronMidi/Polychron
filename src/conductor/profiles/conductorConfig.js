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
  const REQUIRED_TEXTURE_KEYS = ['burstBaseScale', 'flurryBaseScale', 'burstCap', 'flurryCap'];
  const REQUIRED_ATTENUATION_KEYS = ['subsubdivRange', 'subdivRange', 'divRange'];
  const REQUIRED_VOICESPREAD_KEYS = ['spread', 'chordBurstInnerBoost', 'flurryDecayRate', 'jitterAmount'];
  const REQUIRED_FAMILYWEIGHTS_KEYS = ['diatonicCore', 'harmonicMotion', 'development', 'tonalExploration', 'rhythmicDrive'];
  const REQUIRED_EMISSION_KEYS = ['noiseProfile', 'sourceNoiseInfluence', 'reflectionNoiseInfluence', 'bassNoiseInfluence', 'voiceConfigBlend'];
  const REQUIRED_TOP_KEYS = ['density', 'phaseMultipliers', 'stutter', 'energyWeights', 'flicker', 'climaxBoost', 'crossMod', 'fxMix', 'texture', 'attenuation', 'voiceSpread', 'familyWeights', 'emission'];

  const PROFILE_TUNING_DEFAULTS = {
    emissionGate: {
      playBase: 0.72,
      playScale: 0.9,
      stutterBase: 0.6,
      stutterScale: 1.15,
      journeyBoost: 0.08,
      feedbackBoost: 0.08,
      layerBiasScale: 1.0
    },
    feedbackMix: {
      fx: 0.45,
      stutter: 0.2,
      journey: 0.35
    },
    intensityBlend: {
      arc: 0.6,
      tension: 0.4
    },
    stutterGrain: {
      fadeCount: [10, 70],
      fadeDuration: [0.2, 1.5],
      panCount: [30, 90],
      panDuration: [0.1, 1.2],
      fxCount: [30, 100],
      fxDuration: [0.1, 2.0]
    },
    phraseBreath: {
      registerRange: 12,
      densityRange: { min: 0.85, max: 1.3 },
      independence: {
        archInner: 0.7,
        archOuter: 0.3,
        riseFallInner: 0.6,
        riseFallOuter: 0.4,
        buildResolveInner: 0.8,
        buildResolveOuter: 0.3,
        waveBase: 0.4,
        waveAmplitude: 0.4
      },
      dynamism: {
        archBase: 0.5,
        archAmplitude: 0.5,
        riseFallBase: 0.4,
        riseFallAmplitude: 0.6,
        buildResolveBase: 0.3,
        buildResolveSlope: 0.7,
        buildResolveEnd: 0.2,
        waveBase: 0.5,
        waveAmplitude: 0.5
      }
    },
    motifTexture: {
      burstDensity: [0.7, 1.0],
      sparseDensity: [0.3, 0.7],
      burstIntervalDensity: [0.7, 0.95],
      sparseIntervalDensity: [0.4, 0.7]
    },
    motifMutation: {
      transposeRange: [-7, 7]
    },
    spatialCanvas: {
      balOffset: [0, 45],
      balStep: 4,
      sideBias: [-20, 20],
      sideBiasStep: 2,
      lBalMax: 54,
      ccGroupScale: {
        source: 1.0,
        reflection: 1.0,
        bass: 1.0
      }
    },
    noiseCanvas: {
      panRange: 60,
      sustainRange: [0.8, 1.2]
    },
    rhythmDrift: {
      burst: [0.5, 1.5],
      flurry: [0.3, 1.0]
    }
  };

  const PROFILE_TUNING_OVERRIDES = {
    restrained: {
      emissionGate: { playBase: 0.66, playScale: 0.75, stutterBase: 0.52, stutterScale: 0.95, journeyBoost: 0.06, feedbackBoost: 0.05 },
      feedbackMix: { fx: 0.35, stutter: 0.15, journey: 0.5 },
      intensityBlend: { arc: 0.45, tension: 0.55 },
      stutterGrain: { fadeCount: [8, 45], panCount: [18, 60], fxCount: [20, 70] },
      phraseBreath: {
        registerRange: 9,
        densityRange: { min: 0.8, max: 1.1 },
        independence: { archInner: 0.6, archOuter: 0.25, buildResolveInner: 0.7, waveAmplitude: 0.25 },
        dynamism: { archBase: 0.35, archAmplitude: 0.35, waveAmplitude: 0.35 }
      },
      motifTexture: { burstDensity: [0.65, 0.9], sparseDensity: [0.35, 0.65] },
      motifMutation: { transposeRange: [-5, 5] },
      spatialCanvas: {
        balOffset: [0, 35],
        balStep: 3,
        sideBias: [-14, 14],
        lBalMax: 46,
        ccGroupScale: { source: 0.85, reflection: 0.9, bass: 0.85 }
      },
      noiseCanvas: { panRange: 45, sustainRange: [0.9, 1.1] },
      rhythmDrift: { burst: [0.3, 0.9], flurry: [0.2, 0.6] }
    },
    explosive: {
      emissionGate: { playBase: 0.82, playScale: 1.05, stutterBase: 0.72, stutterScale: 1.35, journeyBoost: 0.1, feedbackBoost: 0.12 },
      feedbackMix: { fx: 0.5, stutter: 0.3, journey: 0.2 },
      intensityBlend: { arc: 0.68, tension: 0.32 },
      stutterGrain: {
        fadeCount: [24, 110],
        fadeDuration: [0.15, 1.1],
        panCount: [45, 130],
        panDuration: [0.08, 0.9],
        fxCount: [50, 145],
        fxDuration: [0.08, 1.5]
      },
      phraseBreath: {
        registerRange: 18,
        densityRange: { min: 0.95, max: 1.5 },
        independence: { archInner: 0.82, archOuter: 0.4, buildResolveInner: 0.92, waveAmplitude: 0.55 },
        dynamism: { archBase: 0.6, archAmplitude: 0.55, buildResolveBase: 0.45, buildResolveSlope: 0.9, waveAmplitude: 0.7 }
      },
      motifTexture: { burstDensity: [0.8, 1.0], sparseDensity: [0.25, 0.65], burstIntervalDensity: [0.8, 1.0], sparseIntervalDensity: [0.35, 0.65] },
      motifMutation: { transposeRange: [-12, 12] },
      spatialCanvas: {
        balOffset: [0, 58],
        balStep: 6,
        sideBias: [-30, 30],
        sideBiasStep: 3,
        lBalMax: 70,
        ccGroupScale: { source: 1.2, reflection: 1.35, bass: 1.15 }
      },
      noiseCanvas: { panRange: 80, sustainRange: [0.7, 1.35] },
      rhythmDrift: { burst: [0.9, 2.3], flurry: [0.5, 1.4] }
    },
    atmospheric: {
      emissionGate: { playBase: 0.64, playScale: 0.78, stutterBase: 0.48, stutterScale: 0.88, journeyBoost: 0.1, feedbackBoost: 0.05 },
      feedbackMix: { fx: 0.35, stutter: 0.15, journey: 0.5 },
      intensityBlend: { arc: 0.72, tension: 0.28 },
      stutterGrain: {
        fadeCount: [8, 55],
        fadeDuration: [0.5, 2.2],
        panCount: [16, 64],
        panDuration: [0.3, 1.8],
        fxCount: [18, 72],
        fxDuration: [0.3, 2.4]
      },
      phraseBreath: {
        registerRange: 10,
        densityRange: { min: 0.7, max: 1.15 },
        independence: { archInner: 0.62, archOuter: 0.28, waveAmplitude: 0.3 },
        dynamism: { archBase: 0.35, archAmplitude: 0.35, riseFallBase: 0.3, riseFallAmplitude: 0.45, waveAmplitude: 0.4 }
      },
      motifTexture: { burstDensity: [0.65, 0.9], sparseDensity: [0.25, 0.65], burstIntervalDensity: [0.65, 0.85], sparseIntervalDensity: [0.35, 0.65] },
      motifMutation: { transposeRange: [-5, 5] },
      spatialCanvas: {
        balOffset: [0, 40],
        balStep: 3,
        sideBias: [-18, 18],
        lBalMax: 50,
        ccGroupScale: { source: 0.85, reflection: 1.2, bass: 0.8 }
      },
      noiseCanvas: { panRange: 50, sustainRange: [0.85, 1.3] },
      rhythmDrift: { burst: [0.4, 1.1], flurry: [0.2, 0.8] }
    },
    rhythmicDrive: {
      emissionGate: { playBase: 0.78, playScale: 0.98, stutterBase: 0.7, stutterScale: 1.4, journeyBoost: 0.07, feedbackBoost: 0.11 },
      feedbackMix: { fx: 0.35, stutter: 0.4, journey: 0.25 },
      intensityBlend: { arc: 0.52, tension: 0.48 },
      stutterGrain: {
        fadeCount: [18, 95],
        fadeDuration: [0.15, 1.0],
        panCount: [40, 125],
        panDuration: [0.08, 0.8],
        fxCount: [45, 140],
        fxDuration: [0.08, 1.3]
      },
      phraseBreath: {
        registerRange: 14,
        densityRange: { min: 0.95, max: 1.45 },
        independence: { archInner: 0.78, archOuter: 0.35, buildResolveInner: 0.9, waveAmplitude: 0.5 },
        dynamism: { archBase: 0.55, archAmplitude: 0.5, riseFallBase: 0.5, riseFallAmplitude: 0.55, buildResolveBase: 0.45, buildResolveSlope: 0.85, waveAmplitude: 0.65 }
      },
      motifTexture: { burstDensity: [0.75, 1.0], sparseDensity: [0.3, 0.75], burstIntervalDensity: [0.75, 1.0], sparseIntervalDensity: [0.4, 0.75] },
      motifMutation: { transposeRange: [-9, 9] },
      spatialCanvas: {
        balOffset: [0, 52],
        balStep: 5,
        sideBias: [-24, 24],
        lBalMax: 62,
        ccGroupScale: { source: 1.15, reflection: 0.95, bass: 1.25 }
      },
      noiseCanvas: { panRange: 70, sustainRange: [0.75, 1.15] },
      rhythmDrift: { burst: [0.7, 1.8], flurry: [0.4, 1.2] }
    },
    minimal: {
      emissionGate: { playBase: 0.54, playScale: 0.62, stutterBase: 0.32, stutterScale: 0.55, journeyBoost: 0.04, feedbackBoost: 0.03 },
      feedbackMix: { fx: 0.3, stutter: 0.1, journey: 0.6 },
      intensityBlend: { arc: 0.4, tension: 0.6 },
      stutterGrain: {
        fadeCount: [6, 30],
        fadeDuration: [0.6, 2.6],
        panCount: [10, 40],
        panDuration: [0.5, 2.2],
        fxCount: [12, 45],
        fxDuration: [0.5, 2.8]
      },
      phraseBreath: {
        registerRange: 7,
        densityRange: { min: 0.75, max: 1.05 },
        independence: { archInner: 0.45, archOuter: 0.2, riseFallInner: 0.5, riseFallOuter: 0.3, buildResolveInner: 0.55, buildResolveOuter: 0.2, waveBase: 0.25, waveAmplitude: 0.2 },
        dynamism: { archBase: 0.22, archAmplitude: 0.22, riseFallBase: 0.2, riseFallAmplitude: 0.28, buildResolveBase: 0.18, buildResolveSlope: 0.35, buildResolveEnd: 0.12, waveBase: 0.25, waveAmplitude: 0.2 }
      },
      motifTexture: { burstDensity: [0.6, 0.8], sparseDensity: [0.25, 0.55], burstIntervalDensity: [0.6, 0.8], sparseIntervalDensity: [0.3, 0.55] },
      motifMutation: { transposeRange: [-3, 3] },
      spatialCanvas: {
        balOffset: [0, 28],
        balStep: 2,
        sideBias: [-10, 10],
        sideBiasStep: 1,
        lBalMax: 40,
        ccGroupScale: { source: 0.7, reflection: 0.75, bass: 0.7 }
      },
      noiseCanvas: { panRange: 32, sustainRange: [0.95, 1.05] },
      rhythmDrift: { burst: [0.2, 0.6], flurry: [0.1, 0.4] }
    },
    harmonic: {
      intensityBlend: { arc: 0.35, tension: 0.65 }
    }
  };

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
      if (key === 'journeyBoldness') continue; // scalar, not object
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

    // texture
    for (const k of REQUIRED_TEXTURE_KEYS) {
      if (profile.texture[k] === undefined) throw new Error(`ConductorConfig: ${label}.texture.${k} is required`);
      assertFiniteRange(profile.texture[k], 0, 5, `${label}.texture.${k}`);
    }

    // attenuation
    for (const k of REQUIRED_ATTENUATION_KEYS) {
      if (!Array.isArray(profile.attenuation[k]) || profile.attenuation[k].length !== 2) {
        throw new Error(`ConductorConfig: ${label}.attenuation.${k} must be [min, max]`);
      }
      assertFiniteRange(profile.attenuation[k][0], 0, 20, `${label}.attenuation.${k}[0]`);
      assertFiniteRange(profile.attenuation[k][1], 0, 20, `${label}.attenuation.${k}[1]`);
    }

    // voiceSpread
    for (const k of REQUIRED_VOICESPREAD_KEYS) {
      if (profile.voiceSpread[k] === undefined) throw new Error(`ConductorConfig: ${label}.voiceSpread.${k} is required`);
      assertFiniteRange(profile.voiceSpread[k], 0, 5, `${label}.voiceSpread.${k}`);
    }

    // familyWeights
    for (const k of REQUIRED_FAMILYWEIGHTS_KEYS) {
      if (profile.familyWeights[k] === undefined) throw new Error(`ConductorConfig: ${label}.familyWeights.${k} is required`);
      assertFiniteRange(profile.familyWeights[k], 0, 5, `${label}.familyWeights.${k}`);
    }

    // journeyBoldness
    if (profile.journeyBoldness === undefined) throw new Error(`ConductorConfig: ${label}.journeyBoldness is required`);
    assertFiniteRange(profile.journeyBoldness, 0, 2, `${label}.journeyBoldness`);

    // emission
    for (const k of REQUIRED_EMISSION_KEYS) {
      if (profile.emission[k] === undefined) throw new Error(`ConductorConfig: ${label}.emission.${k} is required`);
      if (k === 'noiseProfile') {
        if (typeof profile.emission[k] !== 'string' || profile.emission[k].length === 0) {
          throw new Error(`ConductorConfig: ${label}.emission.noiseProfile must be a non-empty string`);
        }
      } else {
        assertFiniteRange(profile.emission[k], 0, 1, `${label}.emission.${k}`);
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

  function mergeProfileTuning(base, override) {
    if (Array.isArray(base)) {
      return Array.isArray(override) ? override.slice() : base.slice();
    }
    if (!base || typeof base !== 'object') {
      return override === undefined ? base : override;
    }

    const result = {};
    const keys = new Set([...Object.keys(base), ...Object.keys(override || {})]);
    for (const key of keys) {
      const baseValue = base[key];
      const overrideValue = override ? override[key] : undefined;
      if (overrideValue === undefined) {
        result[key] = Array.isArray(baseValue)
          ? baseValue.slice()
          : (baseValue && typeof baseValue === 'object' ? mergeProfileTuning(baseValue, {}) : baseValue);
      } else if (Array.isArray(baseValue) || Array.isArray(overrideValue)) {
        result[key] = Array.isArray(overrideValue)
          ? overrideValue.slice()
          : (Array.isArray(baseValue) ? baseValue.slice() : overrideValue);
      } else if (baseValue && typeof baseValue === 'object' && overrideValue && typeof overrideValue === 'object') {
        result[key] = mergeProfileTuning(baseValue, overrideValue);
      } else {
        result[key] = overrideValue;
      }
    }
    return result;
  }

  function getProfileTuning() {
    const profileName = getActiveProfileName();
    const override = PROFILE_TUNING_OVERRIDES[profileName] || {};
    return mergeProfileTuning(PROFILE_TUNING_DEFAULTS, override);
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

  /**
   * Get texture scaling parameters for TextureBlender.
   * @returns {{ burstBaseScale: number, flurryBaseScale: number, burstCap: number, flurryCap: number }}
   */
  function getTextureScaling() {
    return resolveField('texture');
  }

  /**
   * Get attenuation range parameters for microUnitAttenuator.
   * @returns {{ subsubdivRange: number[], subdivRange: number[], divRange: number[] }}
   */
  function getAttenuationScaling() {
    return resolveField('attenuation');
  }

  /**
   * Get voice spread parameters for voiceModulator.
   * @returns {{ spread: number, chordBurstInnerBoost: number, flurryDecayRate: number, jitterAmount: number }}
   */
  function getVoiceSpreadScaling() {
    return resolveField('voiceSpread');
  }

  /**
   * Get composer family weight multipliers.
   * @returns {{ diatonicCore: number, harmonicMotion: number, development: number, tonalExploration: number, rhythmicDrive: number }}
   */
  function getFamilyWeights() {
    return resolveField('familyWeights');
  }

  /**
   * Get journey boldness scalar (0-2).
   * @returns {number}
   */
  function getJourneyBoldness() {
    const val = resolveField('journeyBoldness');
    return Number.isFinite(val) ? val : 1.0;
  }

  /**
   * Get emission parameters for playNotes/channelCoherence.
   * @returns {{ noiseProfile: string, sourceNoiseInfluence: number, reflectionNoiseInfluence: number, bassNoiseInfluence: number, voiceConfigBlend: number }}
   */
  function getEmissionScaling() {
    return resolveField('emission');
  }

  function getEmissionGateParams() {
    return getProfileTuning().emissionGate;
  }

  function getFeedbackMixWeights() {
    const weights = getProfileTuning().feedbackMix;
    const sum = Number(weights.fx) + Number(weights.stutter) + Number(weights.journey);
    if (!Number.isFinite(sum) || sum <= 0) {
      return PROFILE_TUNING_DEFAULTS.feedbackMix;
    }
    return {
      fx: Number(weights.fx) / sum,
      stutter: Number(weights.stutter) / sum,
      journey: Number(weights.journey) / sum
    };
  }

  function getGlobalIntensityBlend() {
    const blend = getProfileTuning().intensityBlend;
    const sum = Number(blend.arc) + Number(blend.tension);
    if (!Number.isFinite(sum) || sum <= 0) {
      return PROFILE_TUNING_DEFAULTS.intensityBlend;
    }
    return {
      arc: Number(blend.arc) / sum,
      tension: Number(blend.tension) / sum
    };
  }

  function getStutterGrainParams() {
    return getProfileTuning().stutterGrain;
  }

  function getPhraseBreathParams() {
    return getProfileTuning().phraseBreath;
  }

  function getMotifTextureClampParams() {
    return getProfileTuning().motifTexture;
  }

  function getMotifMutationParams() {
    return getProfileTuning().motifMutation;
  }

  function getSpatialCanvasParams() {
    return getProfileTuning().spatialCanvas;
  }

  function getNoiseCanvasParams() {
    return getProfileTuning().noiseCanvas;
  }

  function getRhythmDriftParams() {
    return getProfileTuning().rhythmDrift;
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

    // Scalar numeric fields (e.g. journeyBoldness): direct lerp
    if (typeof fromVal === 'number' && typeof target === 'number') {
      return fromVal + (target - fromVal) * t;
    }

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

    // Emit regulation state for downstream listeners
    if (typeof EventBus !== 'undefined' && EventBus && typeof EventBus.emit === 'function') {
      EventBus.emit('conductor-regulation', {
        avg,
        densityBias: _regulation.densityBias,
        crossModBias: _regulation.crossModBias,
        profile: activeProfileName
      });
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
    getTextureScaling,
    getAttenuationScaling,
    getVoiceSpreadScaling,
    getFamilyWeights,
    getJourneyBoldness,
    getEmissionScaling,
    getEmissionGateParams,
    getFeedbackMixWeights,
    getGlobalIntensityBlend,
    getStutterGrainParams,
    getPhraseBreathParams,
    getMotifTextureClampParams,
    getMotifMutationParams,
    getSpatialCanvasParams,
    getNoiseCanvasParams,
    getRhythmDriftParams,
    applyPhaseProfile,
    tickCrossfade,
    regulationTick,
    getRegulationDensityBias,
    getRegulationCrossModBias,
    validateProfileOrFail
  };
})();
