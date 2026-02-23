// conductorConfig.js — Conductor profile validation, selection, and access.
// Single authority for the active conductor profile.

ConductorConfig = (() => {
  /** @type {string} */
  let activeProfileName = 'default';

  /** @type {Object|null} */
  let activeProfileCache = null;

  const V = Validator.create('conductorConfig');

  const PROFILE_TUNING_DEFAULTS = conductorConfigTuningDefaults();
  const PROFILE_TUNING_OVERRIDES = conductorConfigTuningOverrides();

  function assertProfileTuningOrFail(tuning, profileName) {
    V.assertPlainObject(tuning, `ConductorConfig.profileTuning.${profileName}`);
    V.assertPlainObject(tuning.journeyFx, `ConductorConfig.profileTuning.${profileName}.journeyFx`);
    V.assertPlainObject(tuning.feedbackMix, `ConductorConfig.profileTuning.${profileName}.feedbackMix`);
    V.assertPlainObject(tuning.intensityBlend, `ConductorConfig.profileTuning.${profileName}.intensityBlend`);
    V.assertPlainObject(tuning.harmonicRhythm, `ConductorConfig.profileTuning.${profileName}.harmonicRhythm`);
    V.assertPlainObject(tuning.noiseProfileByPhase, `ConductorConfig.profileTuning.${profileName}.noiseProfileByPhase`);

    V.assertRange(tuning.journeyFx.distanceDivisor, 0.1, 64, `ConductorConfig.profileTuning.${profileName}.journeyFx.distanceDivisor`);
    V.assertRange(tuning.journeyFx.reverbMaxBoost, 0, 2, `ConductorConfig.profileTuning.${profileName}.journeyFx.reverbMaxBoost`);
    V.assertRange(tuning.journeyFx.filterMaxBoost, 0, 2, `ConductorConfig.profileTuning.${profileName}.journeyFx.filterMaxBoost`);
    V.assertRange(tuning.journeyFx.returnHomePortamentoBoost, 0, 2, `ConductorConfig.profileTuning.${profileName}.journeyFx.returnHomePortamentoBoost`);
    V.assertRange(tuning.journeyFx.returnHomeReverbDamp, 0.1, 2, `ConductorConfig.profileTuning.${profileName}.journeyFx.returnHomeReverbDamp`);

    V.assertRange(tuning.feedbackMix.fx, 0, 10, `ConductorConfig.profileTuning.${profileName}.feedbackMix.fx`);
    V.assertRange(tuning.feedbackMix.stutter, 0, 10, `ConductorConfig.profileTuning.${profileName}.feedbackMix.stutter`);
    V.assertRange(tuning.feedbackMix.journey, 0, 10, `ConductorConfig.profileTuning.${profileName}.feedbackMix.journey`);
    V.assertRange(tuning.intensityBlend.arc, 0, 10, `ConductorConfig.profileTuning.${profileName}.intensityBlend.arc`);
    V.assertRange(tuning.intensityBlend.tension, 0, 10, `ConductorConfig.profileTuning.${profileName}.intensityBlend.tension`);
    V.assertRange(tuning.harmonicRhythm.blendWeight, 0, 0.5, `ConductorConfig.profileTuning.${profileName}.harmonicRhythm.blendWeight`);
    V.assertRange(tuning.harmonicRhythm.feedbackWeight, 0, 0.5, `ConductorConfig.profileTuning.${profileName}.harmonicRhythm.feedbackWeight`);
    V.assertNonEmptyString(tuning.noiseProfileByPhase.default, `ConductorConfig.profileTuning.${profileName}.noiseProfileByPhase.default`);
  }

  function validateProfileOrFail(profile, label) {
    conductorConfigValidateProfile(profile, label);
  }

  function getProfilesOrFail() {
    if (!CONDUCTOR_PROFILE_SOURCES) {
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
  const resolvers = conductorConfigResolvers({ getProfileTuning });
  const accessors = conductorConfigAccessors({ dynamics, getProfileTuning });

  function getProfileTuning() {
    const profileName = getActiveProfileName();
    const override = PROFILE_TUNING_OVERRIDES[profileName];
    const tuning = conductorConfigMergeProfileTuning(PROFILE_TUNING_DEFAULTS, override);
    assertProfileTuningOrFail(tuning, profileName);
    return tuning;
  }

  function getPhaseMultiplier(sectionPhase) {
    const profile = dynamics.resolveField('phaseMultipliers');
    V.assertPlainObject(profile, 'ConductorConfig.getPhaseMultiplier.phaseMultipliers');
    if (typeof sectionPhase !== 'string' || sectionPhase.length === 0) {
      throw new Error('ConductorConfig.getPhaseMultiplier: sectionPhase must be a non-empty string');
    }
    if (!Object.prototype.hasOwnProperty.call(profile, sectionPhase)) {
      throw new Error(`ConductorConfig.getPhaseMultiplier: unknown sectionPhase "${sectionPhase}"`);
    }
    const mult = profile[sectionPhase];
    return V.assertRange(mult, 0, 3, `ConductorConfig.phaseMultipliers.${sectionPhase}`);
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

  return {
    getProfilesOrFail,
    getProfileNames,
    setActiveProfile,
    getActiveProfile,
    getActiveProfileName,
    getPhaseMultiplier,
    getStutterParams,
    getTargetDensity: dynamics.getTargetDensityRegulated,
    getDensitySmoothing: accessors.getDensitySmoothing,
    getDensityBounds: accessors.getDensityBounds,
    getFlickerParams: accessors.getFlickerParams,
    getEnergyWeights: accessors.getEnergyWeights,
    getHintBlendedEnergyWeights: accessors.getHintBlendedEnergyWeights,
    getClimaxBoost: accessors.getClimaxBoost,
    getCrossModScaling: accessors.getCrossModScaling,
    getFxMixScaling: accessors.getFxMixScaling,
    getTextureScaling: accessors.getTextureScaling,
    getAttenuationScaling: accessors.getAttenuationScaling,
    getVoiceSpreadScaling: accessors.getVoiceSpreadScaling,
    getFamilyWeights: accessors.getFamilyWeights,
    getJourneyBoldness: accessors.getJourneyBoldness,
    getArcMapping: accessors.getArcMapping,
    getJourneyFxModulation: resolvers.getJourneyFxModulation,
    getEmissionScaling: accessors.getEmissionScaling,
    getEmissionGateParams: accessors.getEmissionGateParams,
    getFeedbackMixWeights: accessors.getFeedbackMixWeights,
    getGlobalIntensityBlend: accessors.getGlobalIntensityBlend,
    getStutterGrainParams: accessors.getStutterGrainParams,
    getPhraseBreathParams: accessors.getPhraseBreathParams,
    getMotifTextureClampParams: accessors.getMotifTextureClampParams,
    getMotifMutationParams: accessors.getMotifMutationParams,
    getSpatialCanvasParams: accessors.getSpatialCanvasParams,
    getNoiseCanvasParams: accessors.getNoiseCanvasParams,
    getHarmonicRhythmParams: accessors.getHarmonicRhythmParams,
    getNoiseProfileForSection: resolvers.getNoiseProfileForSection,
    getRhythmDriftParams: accessors.getRhythmDriftParams,
    applyPhaseProfile: dynamics.applyPhaseProfile,
    tickCrossfade: dynamics.tickCrossfade,
    regulationTick: dynamics.regulationTick,
    getRegulationDensityBias: dynamics.getRegulationDensityBias,
    getRegulationCrossModBias: dynamics.getRegulationCrossModBias,
    validateProfileOrFail
  };
})();
