// src/composers/DynamismEngine.js - Unified probability modulation for note emission
// Combines phrase arc, harmonic journey tension, and feedback intensity into per-unit play/stutter probabilities.

DynamismEngine = (() => {
  const V = Validator.create('DynamismEngine');
  let dependenciesValidated = false;

  const moveBias = {
    origin: 0,
    hold: 0,
    'return-home': 0.1
  };

  function assertDependencies() {
    if (dependenciesValidated) return;

    // All globals are boot-validated — assert shape once, then skip.
    V.requireDefined(ConductorConfig, 'ConductorConfig');
    V.requireDefined(FXFeedbackListener, 'FXFeedbackListener');
    V.requireDefined(StutterFeedbackListener, 'StutterFeedbackListener');
    V.requireDefined(JourneyRhythmCoupler, 'JourneyRhythmCoupler');
    V.requireDefined(TextureBlender, 'TextureBlender');
    V.requireDefined(HarmonicJourney, 'HarmonicJourney');
    V.requireDefined(LM, 'LM');
    V.requireType(LM.register, 'function', 'LM.register');
    V.assertObject(LM.layers, 'LM.layers');

    dependenciesValidated = true;
  }

  /**
   * Get phrase context from the shared PhraseArcManager or a deterministic fallback.
   * @returns {{dynamism:number, atStart:boolean, atEnd:boolean}}
   */
  function getPhraseContext() {
    return ComposerFactory.sharedPhraseArcManager.getPhraseContext();
  }

  /**
   * Compute baseline probs using existing DYNAMISM policy for compatibility.
   * @param {{dynamism:number, atStart:boolean, atEnd:boolean}} phraseCtx
   * @returns {{playProb:number, stutterProb:number}}
   */
  function getBaseProbs(phraseCtx) {
    const dynScale = DYNAMISM.scaleBase + clamp(Number(phraseCtx.dynamism), 0, 1) * DYNAMISM.scaleRange;
    const basePlayProb = phraseCtx.atStart ? DYNAMISM.playProb.start : DYNAMISM.playProb.mid;
    const baseStutterProb = phraseCtx.atEnd ? DYNAMISM.stutterProb.end : DYNAMISM.stutterProb.mid;
    return {
      playProb: clamp(basePlayProb * dynScale, 0, 1),
      stutterProb: clamp(baseStutterProb * dynScale, 0, 1)
    };
  }

  /**
   * Harmonic tension from current journey stop.
   * @returns {number} 0-1
   */
  function getJourneyEnergy() {
    assertDependencies();
    if (!Number.isFinite(Number(sectionIndex))) {
      return 0;
    }

    const stop = HarmonicJourney.getStop(Number(sectionIndex));
    V.assertObject(stop, 'HarmonicJourney stop');

    const distanceEnergy = clamp(Number(stop.distance) / 6, 0, 1);
    const moveEnergy = Object.prototype.hasOwnProperty.call(moveBias, stop.move)
      ? moveBias[stop.move]
      : clamp(0.2 + distanceEnergy * 0.6, 0, 1);

    return clamp(m.max(distanceEnergy, moveEnergy), 0, 1);
  }

  /**
   * Feedback energy from FX and journey->rhythm coupling systems.
   * @returns {number} 0-1
   */
  function getFeedbackEnergy() {
    assertDependencies();
    const fxEnergy = clamp(Number(FXFeedbackListener.getIntensity()), 0, 1);

    // Use layer-aware stutter intensity (map L1->source, L2->reflection)
    const layerMap = { L1: 'source', L2: 'reflection' };
    const layerProfile = layerMap[LM.activeLayer] || null;
    const stutterLayerIntensity = layerProfile
      ? clamp(Number(StutterFeedbackListener.getIntensity(layerProfile)), 0, 1)
      : 0;

    const stutterOverall = clamp(Number(StutterFeedbackListener.getIntensity()), 0, 1);

    const stutterEnergy = clamp(stutterLayerIntensity * 0.7 + stutterOverall * 0.3, 0, 1);

    const journeyRhythmEnergy = clamp(Number(JourneyRhythmCoupler.getBoldness()), 0, 1);

    const textureEnergy = clamp(Number(TextureBlender.getRecentDensity()), 0, 1) * 0.15;

    const harmonicRhythmParams = ConductorConfig.getHarmonicRhythmParams();
    const harmonicRhythmWeight = clamp(Number(harmonicRhythmParams.feedbackWeight), 0, 0.5);
    const harmonicRhythmEnergy = clamp(Number(HarmonicRhythmTracker.getHarmonicRhythm()), 0, 1) * harmonicRhythmWeight;

    const mixWeights = ConductorConfig.getFeedbackMixWeights();

    // Mix FX + Stutter + Journey energy (profile-driven weighting)
    return clamp(
      fxEnergy * mixWeights.fx +
      stutterEnergy * mixWeights.stutter +
      journeyRhythmEnergy * mixWeights.journey +
      textureEnergy +
      harmonicRhythmEnergy,
      0,
      1
    );
  }

  /**
   * Local per-unit pulse so probabilities evolve inside a measure.
   * @param {'beat'|'div'|'subdiv'|'subsubdiv'} unit
   * @returns {number} 0-1
   */
  function getUnitPulse(unit) {
    return dynamismPulse.compute(unit);
  }

  /**
   * Resolve per-unit play/stutter probabilities.
   * @param {'beat'|'div'|'subdiv'|'subsubdiv'} unit
   * @param {{playProb?:number, stutterProb?:number}} [opts]
   * @returns {{playProb:number, stutterProb:number, composite:number}}
   */
  function resolve(unit, opts = {}) {
    assertDependencies();
    V.assertNonEmptyString(unit, 'unit');

    const phraseCtx = getPhraseContext();
    const base = getBaseProbs(phraseCtx);
    const inputPlay = V.optionalFinite(opts.playProb, base.playProb);
    const inputStutter = V.optionalFinite(opts.stutterProb, base.stutterProb);

    const phraseEnergy = clamp(Number(phraseCtx.dynamism), 0, 1);
    const journeyEnergy = getJourneyEnergy();
    const feedbackEnergy = getFeedbackEnergy();
    const pulseEnergy = getUnitPulse(unit);

    const weights = ConductorConfig.getHintBlendedEnergyWeights();
    const composite = clamp(
      phraseEnergy * weights.phrase +
      journeyEnergy * weights.journey +
      feedbackEnergy * weights.feedback +
      pulseEnergy * weights.pulse,
      0,
      1
    );

    const emissionGate = ConductorConfig.getEmissionGateParams();

    const layerBias = (LM && LM.activeLayer === 'L2') ? 0.04 : 0;
    const playOut = clamp(
      inputPlay * (emissionGate.playBase + composite * emissionGate.playScale) +
      layerBias * 0.5 * emissionGate.layerBiasScale,
      0.02,
      0.98
    );
    const stutterOut = clamp(
      inputStutter * (emissionGate.stutterBase + composite * emissionGate.stutterScale) +
      journeyEnergy * emissionGate.journeyBoost +
      feedbackEnergy * emissionGate.feedbackBoost +
      layerBias * emissionGate.layerBiasScale,
      0.01,
      0.98
    );

    return {
      playProb: playOut,
      stutterProb: stutterOut,
      composite
    };
  }

  return {
    resolve
  };
})();
