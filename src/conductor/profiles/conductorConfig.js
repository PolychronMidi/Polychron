// conductorConfig.js — Conductor profile validation, selection, and access.
// Single authority for the active conductor profile.

ConductorConfig = (() => {
  /** @type {string} */
  let activeProfileName = 'default';

  /** @type {Object|null} */
  let activeProfileCache = null;

  if (typeof Validator === 'undefined' || !Validator) {
    throw new Error('ConductorConfig: Validator utility is required');
  }

  if (typeof conductorConfigValidateProfile !== 'function' || typeof conductorConfigMergeProfileTuning !== 'function' || typeof conductorConfigTuningDefaults !== 'function' || typeof conductorConfigTuningOverrides !== 'function' || typeof conductorConfigDynamics !== 'function') {
    throw new Error('ConductorConfig: required helper globals are missing');
  }

  const PROFILE_TUNING_DEFAULTS = conductorConfigTuningDefaults();
  const PROFILE_TUNING_OVERRIDES = conductorConfigTuningOverrides();

  function assertProfileTuningOrFail(tuning, profileName) {
    Validator.assertPlainObject(tuning, `ConductorConfig.profileTuning.${profileName}`);
    Validator.assertPlainObject(tuning.journeyFx, `ConductorConfig.profileTuning.${profileName}.journeyFx`);
    Validator.assertPlainObject(tuning.feedbackMix, `ConductorConfig.profileTuning.${profileName}.feedbackMix`);
    Validator.assertPlainObject(tuning.intensityBlend, `ConductorConfig.profileTuning.${profileName}.intensityBlend`);
    Validator.assertPlainObject(tuning.harmonicRhythm, `ConductorConfig.profileTuning.${profileName}.harmonicRhythm`);
    Validator.assertPlainObject(tuning.noiseProfileByPhase, `ConductorConfig.profileTuning.${profileName}.noiseProfileByPhase`);

    Validator.assertRange(tuning.journeyFx.distanceDivisor, 0.1, 64, `ConductorConfig.profileTuning.${profileName}.journeyFx.distanceDivisor`);
    Validator.assertRange(tuning.journeyFx.reverbMaxBoost, 0, 2, `ConductorConfig.profileTuning.${profileName}.journeyFx.reverbMaxBoost`);
    Validator.assertRange(tuning.journeyFx.filterMaxBoost, 0, 2, `ConductorConfig.profileTuning.${profileName}.journeyFx.filterMaxBoost`);
    Validator.assertRange(tuning.journeyFx.returnHomePortamentoBoost, 0, 2, `ConductorConfig.profileTuning.${profileName}.journeyFx.returnHomePortamentoBoost`);
    Validator.assertRange(tuning.journeyFx.returnHomeReverbDamp, 0.1, 2, `ConductorConfig.profileTuning.${profileName}.journeyFx.returnHomeReverbDamp`);

    Validator.assertRange(tuning.feedbackMix.fx, 0, 10, `ConductorConfig.profileTuning.${profileName}.feedbackMix.fx`);
    Validator.assertRange(tuning.feedbackMix.stutter, 0, 10, `ConductorConfig.profileTuning.${profileName}.feedbackMix.stutter`);
    Validator.assertRange(tuning.feedbackMix.journey, 0, 10, `ConductorConfig.profileTuning.${profileName}.feedbackMix.journey`);
    Validator.assertRange(tuning.intensityBlend.arc, 0, 10, `ConductorConfig.profileTuning.${profileName}.intensityBlend.arc`);
    Validator.assertRange(tuning.intensityBlend.tension, 0, 10, `ConductorConfig.profileTuning.${profileName}.intensityBlend.tension`);
    Validator.assertRange(tuning.harmonicRhythm.blendWeight, 0, 0.5, `ConductorConfig.profileTuning.${profileName}.harmonicRhythm.blendWeight`);
    Validator.assertRange(tuning.harmonicRhythm.feedbackWeight, 0, 0.5, `ConductorConfig.profileTuning.${profileName}.harmonicRhythm.feedbackWeight`);
    Validator.assertNonEmptyString(tuning.noiseProfileByPhase.default, `ConductorConfig.profileTuning.${profileName}.noiseProfileByPhase.default`);
  }

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
    const override = PROFILE_TUNING_OVERRIDES[profileName];
    const tuning = conductorConfigMergeProfileTuning(PROFILE_TUNING_DEFAULTS, override);
    assertProfileTuningOrFail(tuning, profileName);
    return tuning;
  }

  function getPhaseMultiplier(sectionPhase) {
    const profile = dynamics.resolveField('phaseMultipliers');
    Validator.assertPlainObject(profile, 'ConductorConfig.getPhaseMultiplier.phaseMultipliers');
    if (typeof sectionPhase !== 'string' || sectionPhase.length === 0) {
      throw new Error('ConductorConfig.getPhaseMultiplier: sectionPhase must be a non-empty string');
    }
    if (!Object.prototype.hasOwnProperty.call(profile, sectionPhase)) {
      throw new Error(`ConductorConfig.getPhaseMultiplier: unknown sectionPhase "${sectionPhase}"`);
    }
    const mult = profile[sectionPhase];
    return Validator.assertRange(mult, 0, 3, `ConductorConfig.phaseMultipliers.${sectionPhase}`);
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
    return Validator.assertRange(val, 0, 2, 'ConductorConfig.journeyBoldness');
  }

  /**
   * Return arc mapping for a profile or a specific phase.
   * @param {string} [sectionPhase]
   * @returns {Object|string}
   */
  function getArcMapping(sectionPhase) {
    const arcMapping = dynamics.resolveField('arcMapping');
    Validator.assertPlainObject(arcMapping, 'ConductorConfig.getArcMapping.arcMapping');
    if (typeof sectionPhase === 'string' && sectionPhase.length > 0) {
      if (!Object.prototype.hasOwnProperty.call(arcMapping, sectionPhase)) {
        throw new Error(`ConductorConfig.getArcMapping: unknown sectionPhase "${sectionPhase}"`);
      }
      return Validator.assertNonEmptyString(arcMapping[sectionPhase], `ConductorConfig.arcMapping.${sectionPhase}`);
    }
    return Object.assign({}, arcMapping);
  }

  /**
   * Compute FX modulation scalars based on current journey stop (or an override).
   * @param {{distance?:number,move?:string}|undefined} [stopOverride]
   * @returns {{reverbScale:number,filterScale:number,portamentoScale:number}}
   */
  function getJourneyFxModulation(stopOverride) {
    const profileTuning = getProfileTuning();
    const tuning = profileTuning.journeyFx;

    /** @type {{distance?:number,move?:string}|null} */
    let stop = (stopOverride && typeof stopOverride === 'object') ? stopOverride : null;
    if (!stop) {
      if (typeof HarmonicJourney === 'undefined' || !HarmonicJourney || typeof HarmonicJourney.getStop !== 'function') {
        throw new Error('ConductorConfig.getJourneyFxModulation: HarmonicJourney.getStop is not available');
      }
      if (!Number.isFinite(Number(sectionIndex))) {
        throw new Error(`ConductorConfig.getJourneyFxModulation: sectionIndex must be finite, got ${sectionIndex}`);
      }
      const maybe = HarmonicJourney.getStop(Number(sectionIndex));
      if (!maybe || typeof maybe !== 'object') {
        throw new Error('ConductorConfig.getJourneyFxModulation: HarmonicJourney.getStop returned invalid stop object');
      }
      stop = maybe;
    }

    const distanceDivisor = Validator.assertRange(tuning.distanceDivisor, 0.1, 64, 'ConductorConfig.journeyFx.distanceDivisor');
    const reverbMaxBoost = Validator.assertRange(tuning.reverbMaxBoost, 0, 2, 'ConductorConfig.journeyFx.reverbMaxBoost');
    const filterMaxBoost = Validator.assertRange(tuning.filterMaxBoost, 0, 2, 'ConductorConfig.journeyFx.filterMaxBoost');
    const returnHomePortamentoBoost = Validator.assertRange(tuning.returnHomePortamentoBoost, 0, 2, 'ConductorConfig.journeyFx.returnHomePortamentoBoost');
    const returnHomeReverbDamp = Validator.assertRange(tuning.returnHomeReverbDamp, 0.1, 2, 'ConductorConfig.journeyFx.returnHomeReverbDamp');

    const s = /** @type {{distance?:number,move?:string}} */ (stop);
    const distance = Validator.assertRange(Number(s.distance), 0, 64, 'ConductorConfig.getJourneyFxModulation.stop.distance');
    const move = Validator.assertNonEmptyString(s.move, 'ConductorConfig.getJourneyFxModulation.stop.move');
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
    Validator.assertPlainObject(weights, 'ConductorConfig.getFeedbackMixWeights.feedbackMix');
    const sum = Number(weights.fx) + Number(weights.stutter) + Number(weights.journey);
    if (!Number.isFinite(sum) || sum <= 0) {
      throw new Error(`ConductorConfig.getFeedbackMixWeights: invalid weight sum ${sum}`);
    }
    return {
      fx: Number(weights.fx) / sum,
      stutter: Number(weights.stutter) / sum,
      journey: Number(weights.journey) / sum
    };
  }

  function getGlobalIntensityBlend() {
    const blend = getProfileTuning().intensityBlend;
    Validator.assertPlainObject(blend, 'ConductorConfig.getGlobalIntensityBlend.intensityBlend');
    const sum = Number(blend.arc) + Number(blend.tension);
    if (!Number.isFinite(sum) || sum <= 0) {
      throw new Error(`ConductorConfig.getGlobalIntensityBlend: invalid blend sum ${sum}`);
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
    const cfg = getProfileTuning().harmonicRhythm;
    Validator.assertPlainObject(cfg, 'ConductorConfig.getHarmonicRhythmParams.harmonicRhythm');
    return {
      blendWeight: Validator.assertRange(cfg.blendWeight, 0, 0.5, 'ConductorConfig.harmonicRhythm.blendWeight'),
      feedbackWeight: Validator.assertRange(cfg.feedbackWeight, 0, 0.5, 'ConductorConfig.harmonicRhythm.feedbackWeight')
    };
  }

  /**
   * Resolve noise profile by section phase for conductor-coherent timbral movement.
   * @param {string|undefined} [sectionPhaseOverride]
   * @returns {string}
   */
  function getNoiseProfileForSection(sectionPhaseOverride) {
    const tuning = getProfileTuning();
    const mapping = tuning.noiseProfileByPhase;
    Validator.assertPlainObject(mapping, 'ConductorConfig.noiseProfileByPhase');
    const defaultProfile = Validator.assertNonEmptyString(mapping.default, 'ConductorConfig.noiseProfileByPhase.default');

    const sectionPhase = (typeof sectionPhaseOverride === 'string' && sectionPhaseOverride.length > 0)
      ? sectionPhaseOverride
      : (typeof HarmonicContext !== 'undefined' && HarmonicContext && typeof HarmonicContext.getField === 'function')
        ? (HarmonicContext.getField('sectionPhase') || 'development')
        : 'development';

    const selected = Object.prototype.hasOwnProperty.call(mapping, sectionPhase)
      ? Validator.assertNonEmptyString(mapping[sectionPhase], `ConductorConfig.noiseProfileByPhase.${sectionPhase}`)
      : defaultProfile;
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
