// conductorConfig.js — Conductor profile validation, selection, and access.
// Single authority for the active conductor profile.

ConductorConfig = (() => {
  /** @type {string} */
  let activeProfileName = 'default';

  /** @type {Object|null} */
  let activeProfileCache = null;

  if (typeof conductorConfigValidateProfile !== 'function' || typeof conductorConfigMergeProfileTuning !== 'function' || typeof conductorConfigTuningDefaults !== 'function' || typeof conductorConfigTuningOverrides !== 'function' || typeof conductorConfigDynamics !== 'function') {
    throw new Error('ConductorConfig: required helper globals are missing');
  }

  const PROFILE_TUNING_DEFAULTS = conductorConfigTuningDefaults();
  const PROFILE_TUNING_OVERRIDES = conductorConfigTuningOverrides();

  function validateProfileOrFail(profile, label) {
    conductorConfigValidateProfile(profile, label);
  }

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

  function getProfileNames() {
    return Object.keys(getProfilesOrFail());
  }

  function setActiveProfile(name) {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('ConductorConfig.setActiveProfile: name must be a non-empty string');
    }
    const profiles = getProfilesOrFail();
    if (!Object.prototype.hasOwnProperty.call(profiles, name)) {
      throw new Error(`ConductorConfig.setActiveProfile: unknown profile "${name}"`);
    }
    activeProfileName = name;
    activeProfileCache = null;
  }

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

  function getActiveProfileName() {
    return activeProfileName;
  }

  const dynamics = conductorConfigDynamics({ getActiveProfile, getActiveProfileName, setActiveProfile });

  function getProfileTuning() {
    const profileName = getActiveProfileName();
    const override = PROFILE_TUNING_OVERRIDES[profileName] || {};
    return conductorConfigMergeProfileTuning(PROFILE_TUNING_DEFAULTS, override);
  }

  function getPhaseMultiplier(sectionPhase) {
    const profile = dynamics.resolveField('phaseMultipliers');
    const mult = profile[sectionPhase];
    return Number.isFinite(Number(mult)) ? Number(mult) : 1.0;
  }

  function getStutterParams(compositeIntensity) {
    const stutterProfile = dynamics.resolveField('stutter');
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

  function getDensitySmoothing() {
    return dynamics.resolveField('density').smoothing;
  }

  function getDensityBounds() {
    const density = dynamics.resolveField('density');
    return { floor: density.floor, ceiling: density.ceiling };
  }

  function getFlickerParams() {
    const flicker = dynamics.resolveField('flicker');
    return { depthScale: flicker.depthScale, crossModWeight: flicker.crossModWeight };
  }

  function getEnergyWeights() {
    return dynamics.resolveField('energyWeights');
  }

  function getClimaxBoost() {
    return dynamics.resolveField('climaxBoost');
  }

  function getCrossModScaling() {
    return dynamics.resolveField('crossMod');
  }

  function getFxMixScaling() {
    return dynamics.resolveField('fxMix');
  }

  function getTextureScaling() {
    return dynamics.resolveField('texture');
  }

  function getAttenuationScaling() {
    return dynamics.resolveField('attenuation');
  }

  function getVoiceSpreadScaling() {
    return dynamics.resolveField('voiceSpread');
  }

  function getFamilyWeights() {
    return dynamics.resolveField('familyWeights');
  }

  function getJourneyBoldness() {
    const val = Number(dynamics.resolveField('journeyBoldness'));
    return Number.isFinite(val) ? val : 1.0;
  }

  /**
   * Return arc mapping for a profile or a specific phase.
   * @param {string} [sectionPhase]
   * @returns {Object|string}
   */
  function getArcMapping(sectionPhase) {
    const fallback = {
      intro: 'arch',
      opening: 'arch',
      exposition: 'rise-fall',
      development: 'wave',
      climax: 'build-resolve',
      resolution: 'rise-fall',
      conclusion: 'rise-fall',
      coda: 'arch'
    };
    const arcMapping = dynamics.resolveField('arcMapping');
    const mapping = (arcMapping && typeof arcMapping === 'object') ? arcMapping : fallback;
    if (typeof sectionPhase === 'string' && sectionPhase.length > 0) {
      const selected = mapping[sectionPhase] || fallback[sectionPhase] || fallback.development;
      return typeof selected === 'string' ? selected : fallback.development;
    }
    return Object.assign({}, fallback, mapping);
  }

  /**
   * Compute FX modulation scalars based on current journey stop (or an override).
   * @param {{distance?:number,move?:string}|undefined} [stopOverride]
   * @returns {{reverbScale:number,filterScale:number,portamentoScale:number}}
   */
  function getJourneyFxModulation(stopOverride) {
    const tuning = getProfileTuning().journeyFx || {
      distanceDivisor: 6,
      reverbMaxBoost: 0.4,
      filterMaxBoost: 0.2,
      returnHomePortamentoBoost: 0.5,
      returnHomeReverbDamp: 0.8
    };

    /** @type {{distance?:number,move?:string}|null} */
    let stop = (stopOverride && typeof stopOverride === 'object') ? stopOverride : null;
    if (!stop) {
      if (typeof HarmonicJourney !== 'undefined' && HarmonicJourney && typeof HarmonicJourney.getStop === 'function' && Number.isFinite(Number(sectionIndex))) {
        try {
          const maybe = HarmonicJourney.getStop(Number(sectionIndex));
          stop = (maybe && typeof maybe === 'object') ? maybe : { distance: 0, move: 'hold' };
        } catch {
          stop = { distance: 0, move: 'hold' };
        }
      } else {
        stop = { distance: 0, move: 'hold' };
      }
    }

    const distanceDivisor = Number.isFinite(Number(tuning.distanceDivisor)) ? m.max(0.1, Number(tuning.distanceDivisor)) : 6;
    const reverbMaxBoost = Number.isFinite(Number(tuning.reverbMaxBoost)) ? Number(tuning.reverbMaxBoost) : 0.4;
    const filterMaxBoost = Number.isFinite(Number(tuning.filterMaxBoost)) ? Number(tuning.filterMaxBoost) : 0.2;
    const returnHomePortamentoBoost = Number.isFinite(Number(tuning.returnHomePortamentoBoost)) ? Number(tuning.returnHomePortamentoBoost) : 0.5;
    const returnHomeReverbDamp = Number.isFinite(Number(tuning.returnHomeReverbDamp)) ? Number(tuning.returnHomeReverbDamp) : 0.8;

    const s = /** @type {{distance?:number,move?:string}} */ (stop || { distance: 0, move: 'hold' });
    const distance = Number.isFinite(Number(s.distance)) ? Number(s.distance) : 0;
    const move = (typeof s.move === 'string' && s.move.length > 0) ? s.move : 'hold';
    const distanceFactor = clamp(distance / distanceDivisor, 0, 1);

    const baseReverbScale = 1 + distanceFactor * reverbMaxBoost;
    const reverbScale = move === 'return-home'
      ? clamp(baseReverbScale * returnHomeReverbDamp, 0.4, 2)
      : clamp(baseReverbScale, 0.4, 2);

    return {
      reverbScale,
      filterScale: clamp(1 + distanceFactor * filterMaxBoost, 0.4, 2),
      portamentoScale: move === 'return-home'
        ? clamp(1 + returnHomePortamentoBoost, 0.4, 2)
        : 1
    };
  }

  function getEmissionScaling() {
    return dynamics.resolveField('emission');
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

  function getHarmonicRhythmParams() {
    const defaults = { blendWeight: 0.15, feedbackWeight: 0.2 };
    const cfg = getProfileTuning().harmonicRhythm;
    if (!cfg || typeof cfg !== 'object') return defaults;
    return {
      blendWeight: Number.isFinite(Number(cfg.blendWeight)) ? clamp(Number(cfg.blendWeight), 0, 0.5) : defaults.blendWeight,
      feedbackWeight: Number.isFinite(Number(cfg.feedbackWeight)) ? clamp(Number(cfg.feedbackWeight), 0, 0.5) : defaults.feedbackWeight
    };
  }

  /**
   * Resolve noise profile by section phase for conductor-coherent timbral movement.
   * @param {string|undefined} [sectionPhaseOverride]
   * @returns {string}
   */
  function getNoiseProfileForSection(sectionPhaseOverride) {
    const defaultMapping = {
      intro: 'micro',
      opening: 'subtle',
      exposition: 'subtle',
      development: 'moderate',
      climax: 'dramatic',
      resolution: 'subtle',
      conclusion: 'micro',
      coda: 'micro',
      default: 'subtle'
    };

    const tuning = getProfileTuning();
    const mapping = (tuning.noiseProfileByPhase && typeof tuning.noiseProfileByPhase === 'object')
      ? tuning.noiseProfileByPhase
      : (typeof CONDUCTOR_NOISE_PROFILE_BY_PHASE !== 'undefined' && CONDUCTOR_NOISE_PROFILE_BY_PHASE && typeof CONDUCTOR_NOISE_PROFILE_BY_PHASE === 'object')
        ? CONDUCTOR_NOISE_PROFILE_BY_PHASE
        : defaultMapping;

    const sectionPhase = (typeof sectionPhaseOverride === 'string' && sectionPhaseOverride.length > 0)
      ? sectionPhaseOverride
      : (typeof HarmonicContext !== 'undefined' && HarmonicContext && typeof HarmonicContext.getField === 'function')
        ? (HarmonicContext.getField('sectionPhase') || 'development')
        : 'development';

    const selected = mapping[sectionPhase] || mapping.default || defaultMapping.default;
    if (typeof NOISE_PROFILES !== 'undefined' && NOISE_PROFILES && typeof NOISE_PROFILES === 'object') {
      if (!Object.prototype.hasOwnProperty.call(NOISE_PROFILES, selected)) {
        throw new Error(`ConductorConfig.getNoiseProfileForSection: unknown noise profile "${selected}"`);
      }
    }
    return selected;
  }

  function getRhythmDriftParams() {
    return getProfileTuning().rhythmDrift;
  }

  return {
    getProfilesOrFail,
    getProfileNames,
    setActiveProfile,
    getActiveProfile,
    getActiveProfileName,
    getPhaseMultiplier,
    getStutterParams,
    getTargetDensity: dynamics.getTargetDensityRegulated,
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
    getArcMapping,
    getJourneyFxModulation,
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
    getHarmonicRhythmParams,
    getNoiseProfileForSection,
    getRhythmDriftParams,
    applyPhaseProfile: dynamics.applyPhaseProfile,
    tickCrossfade: dynamics.tickCrossfade,
    regulationTick: dynamics.regulationTick,
    getRegulationDensityBias: dynamics.getRegulationDensityBias,
    getRegulationCrossModBias: dynamics.getRegulationCrossModBias,
    validateProfileOrFail
  };
})();
