conductorConfigValidateProfile = (profile, label) => {
  const V = validator.create('conductorConfigValidateProfile');
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
  const REQUIRED_ARCMAPPING_KEYS = ['intro', 'opening', 'exposition', 'development', 'climax', 'resolution', 'conclusion', 'coda'];
  const VALID_ARC_TYPES = ['arch', 'rise-fall', 'build-resolve', 'wave'];
  const REQUIRED_TOP_KEYS = ['density', 'phaseMultipliers', 'arcMapping', 'stutter', 'energyWeights', 'flicker', 'climaxBoost', 'crossMod', 'fxMix', 'texture', 'attenuation', 'voiceSpread', 'familyWeights', 'emission'];

  const assertFiniteRange = (value, min, max, path) => {
    V.assertRange(value, min, max, `ConductorConfig.${path}`);
  };

  V.assertPlainObject(profile, `ConductorConfig.validateProfileOrFail ${label}`);

  for (const key of REQUIRED_TOP_KEYS) {
    if (key === 'journeyBoldness') continue;
    if (!profile[key] || typeof profile[key] !== 'object') {
      throw new Error(`ConductorConfig.validateProfileOrFail: ${label}.${key} must be an object`);
    }
  }

  for (const key of REQUIRED_DENSITY_KEYS) {
    if (profile.density[key] === undefined) throw new Error(`ConductorConfig: ${label}.density.${key} is required`);
  }
  assertFiniteRange(profile.density.floor, 0, 1, `${label}.density.floor`);
  assertFiniteRange(profile.density.ceiling, 0, 1, `${label}.density.ceiling`);
  if (profile.density.floor > profile.density.ceiling) throw new Error(`ConductorConfig: ${label}.density.floor must be <= ceiling`);
  if (!Array.isArray(profile.density.range) || profile.density.range.length !== 2) throw new Error(`ConductorConfig: ${label}.density.range must be [min, max]`);
  assertFiniteRange(profile.density.range[0], 0, 1, `${label}.density.range[0]`);
  assertFiniteRange(profile.density.range[1], 0, 1, `${label}.density.range[1]`);
  assertFiniteRange(profile.density.smoothing, 0, 1, `${label}.density.smoothing`);

  if (typeof profile.phaseMultipliers !== 'object') throw new Error(`ConductorConfig: ${label}.phaseMultipliers must be an object`);
  for (const [phase, mult] of Object.entries(profile.phaseMultipliers)) {
    const num = Number(mult);
    if (!Number.isFinite(num) || num < 0 || num > 3) {
      throw new Error(`ConductorConfig: ${label}.phaseMultipliers.${phase} must be finite in [0, 3]`);
    }
  }

  for (const key of REQUIRED_ARCMAPPING_KEYS) {
    if (typeof profile.arcMapping[key] !== 'string' || !VALID_ARC_TYPES.includes(profile.arcMapping[key])) {
      throw new Error(`ConductorConfig: ${label}.arcMapping.${key} must be one of ${VALID_ARC_TYPES.join(', ')}`);
    }
  }

  for (const key of REQUIRED_STUTTER_KEYS) {
    if (profile.stutter[key] === undefined) throw new Error(`ConductorConfig: ${label}.stutter.${key} is required`);
  }
  if (!Array.isArray(profile.stutter.rateTiers) || profile.stutter.rateTiers.length === 0) {
    throw new Error(`ConductorConfig: ${label}.stutter.rateTiers must be a non-empty array`);
  }
  for (let index = 0; index < profile.stutter.rateTiers.length; index++) {
    const tier = profile.stutter.rateTiers[index];
    if (!tier || typeof tier !== 'object') throw new Error(`ConductorConfig: ${label}.stutter.rateTiers[${index}] must be an object`);
    assertFiniteRange(tier.threshold, 0, 1, `${label}.stutter.rateTiers[${index}].threshold`);
    if (!Number.isFinite(Number(tier.rate)) || Number(tier.rate) <= 0) throw new Error(`ConductorConfig: ${label}.stutter.rateTiers[${index}].rate must be positive`);
  }
  assertFiniteRange(profile.stutter.coherenceFlip, 0, 1, `${label}.stutter.coherenceFlip`);
  assertFiniteRange(profile.stutter.rateCurveFlip, 0, 1, `${label}.stutter.rateCurveFlip`);

  for (const key of REQUIRED_ENERGY_KEYS) {
    if (profile.energyWeights[key] === undefined) throw new Error(`ConductorConfig: ${label}.energyWeights.${key} is required`);
    assertFiniteRange(profile.energyWeights[key], 0, 1, `${label}.energyWeights.${key}`);
  }
  const weightSum = REQUIRED_ENERGY_KEYS.reduce((sum, key) => sum + Number(profile.energyWeights[key]), 0);
  if (m.abs(weightSum - 1.0) > 0.01) {
    throw new Error(`ConductorConfig: ${label}.energyWeights must sum to 1.0 (got ${weightSum.toFixed(4)})`);
  }

  for (const key of REQUIRED_FLICKER_KEYS) {
    if (profile.flicker[key] === undefined) throw new Error(`ConductorConfig: ${label}.flicker.${key} is required`);
    const num = Number(profile.flicker[key]);
    if (!Number.isFinite(num) || num < 0 || num > 5) {
      throw new Error(`ConductorConfig: ${label}.flicker.${key} must be finite in [0, 5]`);
    }
  }

  for (const key of REQUIRED_CLIMAX_KEYS) {
    if (profile.climaxBoost[key] === undefined) throw new Error(`ConductorConfig: ${label}.climaxBoost.${key} is required`);
    const num = Number(profile.climaxBoost[key]);
    if (!Number.isFinite(num) || num < 0.5 || num > 3) {
      throw new Error(`ConductorConfig: ${label}.climaxBoost.${key} must be finite in [0.5, 3]`);
    }
  }

  for (const key of REQUIRED_CROSSMOD_KEYS) {
    if (profile.crossMod[key] === undefined) throw new Error(`ConductorConfig: ${label}.crossMod.${key} is required`);
    assertFiniteRange(profile.crossMod[key], 0, 5, `${label}.crossMod.${key}`);
  }

  for (const key of REQUIRED_FXMIX_KEYS) {
    if (profile.fxMix[key] === undefined) throw new Error(`ConductorConfig: ${label}.fxMix.${key} is required`);
    assertFiniteRange(profile.fxMix[key], 0, 5, `${label}.fxMix.${key}`);
  }

  for (const key of REQUIRED_TEXTURE_KEYS) {
    if (profile.texture[key] === undefined) throw new Error(`ConductorConfig: ${label}.texture.${key} is required`);
    assertFiniteRange(profile.texture[key], 0, 5, `${label}.texture.${key}`);
  }

  for (const key of REQUIRED_ATTENUATION_KEYS) {
    if (!Array.isArray(profile.attenuation[key]) || profile.attenuation[key].length !== 2) {
      throw new Error(`ConductorConfig: ${label}.attenuation.${key} must be [min, max]`);
    }
    assertFiniteRange(profile.attenuation[key][0], 0, 20, `${label}.attenuation.${key}[0]`);
    assertFiniteRange(profile.attenuation[key][1], 0, 20, `${label}.attenuation.${key}[1]`);
  }

  for (const key of REQUIRED_VOICESPREAD_KEYS) {
    if (profile.voiceSpread[key] === undefined) throw new Error(`ConductorConfig: ${label}.voiceSpread.${key} is required`);
    assertFiniteRange(profile.voiceSpread[key], 0, 5, `${label}.voiceSpread.${key}`);
  }

  for (const key of REQUIRED_FAMILYWEIGHTS_KEYS) {
    if (profile.familyWeights[key] === undefined) throw new Error(`ConductorConfig: ${label}.familyWeights.${key} is required`);
    assertFiniteRange(profile.familyWeights[key], 0, 5, `${label}.familyWeights.${key}`);
  }

  if (profile.journeyBoldness === undefined) throw new Error(`ConductorConfig: ${label}.journeyBoldness is required`);
  assertFiniteRange(profile.journeyBoldness, 0, 2, `${label}.journeyBoldness`);

  for (const key of REQUIRED_EMISSION_KEYS) {
    if (profile.emission[key] === undefined) throw new Error(`ConductorConfig: ${label}.emission.${key} is required`);
    if (key === 'noiseProfile') {
      if (typeof profile.emission[key] !== 'string' || profile.emission[key].length === 0) {
        throw new Error(`ConductorConfig: ${label}.emission.noiseProfile must be a non-empty string`);
      }
    } else {
      assertFiniteRange(profile.emission[key], 0, 1, `${label}.emission.${key}`);
    }
  }
};
