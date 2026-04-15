// conductorConfigAccessors.js - Extracted accessor methods for conductorConfig.
// Pure delegates to dynamics.resolveField() or getProfileTuning() sub-keys.
// Loaded before conductorConfig.js; called once with { dynamics, getProfileTuning }.

conductorConfigAccessors = (deps) => {
  const { dynamics, getProfileTuning } = deps;
  const V = validator.create('conductorConfigAccessors');

  // -- dynamics.resolveField delegates -

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

  /**
   * Energy weights blended with profileAdaptation hints.
   * Restraint hint pulls phrase back and elevates feedback reactivity;
   * explosive hint amplifies phrase-arc energy;
   * atmospheric hint softens pulse micro-oscillation.
   */
  function getHintBlendedEnergyWeights() {
    const base = dynamics.resolveField('energyWeights');
    const restrainedHint = clamp(signalReader.state('profileHintRestrained') ?? 0, 0, 1);
    const explosiveHint = clamp(signalReader.state('profileHintExplosive') ?? 0, 0, 1);
    const atmosphericHint = clamp(signalReader.state('profileHintAtmospheric') ?? 0, 0, 1);
    return {
      phrase: clamp(base.phrase * (1 - restrainedHint * 0.2 + explosiveHint * 0.2), 0.05, 2),
      journey: base.journey,
      feedback: clamp(base.feedback * (1 + restrainedHint * 0.3), 0.05, 2),
      pulse: clamp(base.pulse * (1 - atmosphericHint * 0.4), 0.05, 2)
    };
  }

  function getClimaxBoost() { return dynamics.resolveField('climaxBoost'); }
  function getCrossModScaling() { return dynamics.resolveField('crossMod'); }
  function getFxMixScaling() { return dynamics.resolveField('fxMix'); }
  function getTextureScaling() { return dynamics.resolveField('texture'); }
  function getAttenuationScaling() { return dynamics.resolveField('attenuation'); }
  function getVoiceSpreadScaling() { return dynamics.resolveField('voiceSpread'); }
  function getFamilyWeights() { return dynamics.resolveField('familyWeights'); }
  function getEmissionScaling() { return dynamics.resolveField('emission'); }

  function getJourneyBoldness() {
    const val = Number(dynamics.resolveField('journeyBoldness'));
    return V.assertRange(val, 0, 2, 'conductorConfig.journeyBoldness');
  }

  /**
   * Return arc mapping for a profile or a specific phase.
   * @param {string} [sectionPhase]
   * @returns {Object|string}
   */
  function getArcMapping(sectionPhase) {
    const arcMapping = dynamics.resolveField('arcMapping');
    V.assertPlainObject(arcMapping, 'conductorConfig.getArcMapping.arcMapping');
    if (typeof sectionPhase === 'string' && sectionPhase.length > 0) {
      if (!Object.prototype.hasOwnProperty.call(arcMapping, sectionPhase)) {
        throw new Error(`conductorConfig.getArcMapping: unknown sectionPhase "${sectionPhase}"`);
      }
      let arcType = V.assertNonEmptyString(arcMapping[sectionPhase], `conductorConfig.arcMapping.${sectionPhase}`);
      // R21: feedback energy can override arc type. High energy = build-resolve, oscillating = wave.
      // compositeIntensity is legitimately optional during preBoot before the signal bridge has
      // data; use optionalFinite with 0 baseline rather than `|| 0` (which would also swallow NaN).
      const fbEnergy = safePreBoot.call(() => {
        const sigs = conductorSignalBridge.getSignals();
        return V.optionalFinite(sigs.compositeIntensity, 0);
      }, 0);
      if (fbEnergy > 0.7 && rf() < 0.3) arcType = 'build-resolve';
      else if (fbEnergy < 0.25 && rf() < 0.2) arcType = 'wave';
      return arcType;
    }
    return Object.assign({}, arcMapping);
  }

  // -- getProfileTuning() delegates -

  function getEmissionGateParams() { return getProfileTuning().emissionGate; }
  function getStutterGrainParams() { return getProfileTuning().stutterGrain; }
  function getPhraseBreathParams() { return getProfileTuning().phraseBreath; }
  function getMotifTextureClampParams() { return getProfileTuning().motifTexture; }
  function getMotifMutationParams() { return getProfileTuning().motifMutation; }
  function getSpatialCanvasParams() { return getProfileTuning().spatialCanvas; }
  function getNoiseCanvasParams() { return getProfileTuning().noiseCanvas; }
  function getRhythmDriftParams() { return getProfileTuning().rhythmDrift; }

  function getFeedbackMixWeights() {
    const weights = getProfileTuning().feedbackMix;
    V.assertPlainObject(weights, 'conductorConfig.getFeedbackMixWeights.feedbackMix');
    const sum = Number(weights.fx) + Number(weights.stutter) + Number(weights.journey);
    V.requireFinite(sum, 'sum');
    if (sum <= 0) {
      throw new Error(`conductorConfig.getFeedbackMixWeights: invalid weight sum ${sum}`);
    }
    return {
      fx: Number(weights.fx) / sum,
      stutter: Number(weights.stutter) / sum,
      journey: Number(weights.journey) / sum
    };
  }

  function getGlobalIntensityBlend() {
    const blend = getProfileTuning().intensityBlend;
    V.assertPlainObject(blend, 'conductorConfig.getGlobalIntensityBlend.intensityBlend');
    const sum = Number(blend.arc) + Number(blend.tension);
    V.requireFinite(sum, 'sum');
    if (sum <= 0) {
      throw new Error(`conductorConfig.getGlobalIntensityBlend: invalid blend sum ${sum}`);
    }
    return {
      arc: Number(blend.arc) / sum,
      tension: Number(blend.tension) / sum
    };
  }

  function getHarmonicRhythmParams() {
    const cfg = getProfileTuning().harmonicRhythm;
    V.assertPlainObject(cfg, 'conductorConfig.getHarmonicRhythmParams.harmonicRhythm');
    return {
      blendWeight: V.assertRange(cfg.blendWeight, 0, 0.5, 'conductorConfig.harmonicRhythm.blendWeight'),
      feedbackWeight: V.assertRange(cfg.feedbackWeight, 0, 0.5, 'conductorConfig.harmonicRhythm.feedbackWeight')
    };
  }

  return {
    getDensitySmoothing,
    getDensityBounds,
    getFlickerParams,
    getEnergyWeights,
    getHintBlendedEnergyWeights,
    getClimaxBoost,
    getCrossModScaling,
    getFxMixScaling,
    getTextureScaling,
    getAttenuationScaling,
    getVoiceSpreadScaling,
    getFamilyWeights,
    getEmissionScaling,
    getJourneyBoldness,
    getArcMapping,
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
    getRhythmDriftParams
  };
};
