// src/composers/dynamismEngine.js - Unified probability modulation for note emission
// Combines phrase arc, harmonic journey tension, and feedback intensity into per-unit play/stutter probabilities.

dynamismEngine = (() => {
  const V = validator.create('dynamismEngine');
  let dependenciesValidated = false;
  let dynamismEngineResolveCacheKey = '';
  let dynamismEngineResolveCacheValue = null;

  const moveBias = {
    origin: 0,
    hold: 0,
    'return-home': 0.1
  };

  function assertDependencies() {
    if (dependenciesValidated) return;

    // All globals are boot-validated - assert shape once, then skip.
    V.assertManagerShape(conductorConfig, 'conductorConfig', ['getHintBlendedEnergyWeights', 'getEmissionGateParams', 'getFeedbackMixWeights']);
    V.assertManagerShape(FXFeedbackListener, 'FXFeedbackListener', ['getIntensity']);
    V.assertManagerShape(stutterFeedbackListener, 'stutterFeedbackListener', ['getIntensity']);
    V.assertManagerShape(journeyRhythmCoupler, 'journeyRhythmCoupler', ['getBoldness']);
    V.assertManagerShape(textureBlender, 'textureBlender', ['getRecentDensity']);
    V.assertManagerShape(harmonicJourney, 'harmonicJourney', ['getStop']);
    V.assertManagerShape(dynamicRoleSwap, 'dynamicRoleSwap', ['getIsSwapped']);
    V.assertManagerShape(absoluteTimeWindow, 'absoluteTimeWindow', ['countNotes']);
    V.assertManagerShape(LM, 'LM', ['register', 'activate']);
    V.assertObject(LM.layers, 'LM.layers');

    dependenciesValidated = true;
  }

  /**
   * Get phrase context from the shared PhraseArcManager or a deterministic fallback.
   * @returns {{dynamism:number, atStart:boolean, atEnd:boolean}}
   */
  function getPhraseContext() {
    return FactoryManager.sharedPhraseArcManager.getPhraseContext();
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
    V.requireFinite(Number(sectionIndex), 'sectionIndex');

    const stop = harmonicJourney.getStop(Number(sectionIndex));
    V.assertObject(stop, 'harmonicJourney stop');

    // R28 E2: Sharper distance energy scaling (/ 5 vs / 6) so bold harmonic
    // moves translate to more energetic output
    const distanceEnergy = clamp(Number(stop.distance) / 5, 0, 1);
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
    const fxEnergy = clamp(V.optionalFinite(Number(FXFeedbackListener.getIntensity()), 0), 0, 1);

    // Use layer-aware stutter intensity (map L1->source, L2->reflection)
    const layerMap = { L1: 'source', L2: 'reflection' };
    const layerProfile = layerMap[LM.activeLayer] || null;
    const stutterLayerIntensity = layerProfile
      ? clamp(V.optionalFinite(Number(stutterFeedbackListener.getIntensity(layerProfile)), 0), 0, 1)
      : 0;

    const stutterOverall = clamp(V.optionalFinite(Number(stutterFeedbackListener.getIntensity()), 0), 0, 1);

    const stutterEnergy = clamp(stutterLayerIntensity * 0.7 + stutterOverall * 0.3, 0, 1);

    const journeyRhythmEnergy = clamp(V.optionalFinite(Number(journeyRhythmCoupler.getBoldness()), 0), 0, 1);

    const textureEnergy = clamp(V.optionalFinite(Number(textureBlender.getRecentDensity()), 0), 0, 1) * 0.15;

    const harmonicRhythmParams = conductorConfig.getHarmonicRhythmParams();
    const harmonicRhythmWeight = clamp(Number(harmonicRhythmParams.feedbackWeight), 0, 0.5);
    const harmonicRhythmEnergy = clamp(V.optionalFinite(Number(harmonicRhythmTracker.getHarmonicRhythm()), 0), 0, 1) * harmonicRhythmWeight;

    const mixWeights = conductorConfig.getFeedbackMixWeights();

    // Mix FX + stutter + Journey energy (profile-driven weighting)
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
    return clamp(V.optionalFinite(dynamismPulse.compute(unit), 0.5), 0, 1);
  }

  function getBeatStableResolveContext() {
    const activeLayerName = LM && typeof LM.activeLayer === 'string' ? LM.activeLayer : 'unknown';
    const cacheKey = `${activeLayerName}:${Number(beatStart)}`;
    if (dynamismEngineResolveCacheKey === cacheKey && dynamismEngineResolveCacheValue) {
      return dynamismEngineResolveCacheValue;
    }

    const phraseCtx = getPhraseContext();
    const base = getBaseProbs(phraseCtx);
    const phraseEnergy = clamp(V.optionalFinite(Number(phraseCtx.dynamism), 0.5), 0, 1);
    const journeyEnergy = getJourneyEnergy();
    const feedbackEnergy = getFeedbackEnergy();
    const weights = conductorConfig.getHintBlendedEnergyWeights();
    const emissionGate = conductorConfig.getEmissionGateParams();
    const playBase = V.optionalFinite(Number(emissionGate.playBase), 0.72);
    const playScale = V.optionalFinite(Number(emissionGate.playScale), 0.9);
    const stutterBase = V.optionalFinite(Number(emissionGate.stutterBase), 0.6);
    const stutterScale = V.optionalFinite(Number(emissionGate.stutterScale), 1.25);
    const journeyBoost = V.optionalFinite(Number(emissionGate.journeyBoost), 0.08);
    const feedbackBoost = V.optionalFinite(Number(emissionGate.feedbackBoost), 0.08);
    const layerBiasScale = V.optionalFinite(Number(emissionGate.layerBiasScale), 1.0);
    const activeRegime = safePreBoot.call(() => systemDynamicsProfiler.getSnapshot().regime, 'evolving');
    const dynamics = safePreBoot.call(() => systemDynamicsProfiler.getSnapshot(), null);
    const axisEnergy = safePreBoot.call(() => pipelineCouplingManager.getAxisEnergyShare(), null);
    const phaseShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.phase === 'number'
      ? axisEnergy.shares.phase
      : 1.0 / 6.0;
    const trustShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.trust === 'number'
      ? axisEnergy.shares.trust
      : 1.0 / 6.0;
    const couplingMatrix = dynamics && dynamics.couplingMatrix ? dynamics.couplingMatrix : null;
    const dynamicSnap = /** @type {any} */ (dynamics);
    const densityFlickerPressure = couplingMatrix && typeof couplingMatrix['density-flicker'] === 'number'
      ? clamp((m.abs(couplingMatrix['density-flicker']) - 0.74) / 0.18, 0, 1)
      : 0;
    const densityTrustPressure = couplingMatrix && typeof couplingMatrix['density-trust'] === 'number'
      ? clamp((m.abs(couplingMatrix['density-trust']) - 0.72) / 0.18, 0, 1)
      : 0;
    const recoveryContainmentPressure = clamp(densityFlickerPressure * 0.60 + densityTrustPressure * 0.40, 0, 1);
    const activeProfileName = conductorConfig.getActiveProfileName();
    const evolvingShare = dynamicSnap && typeof dynamicSnap.evolvingShare === 'number'
      ? dynamicSnap.evolvingShare
      : 0;
    const evolvingRecoveryPressure = clamp((0.05 - evolvingShare) / 0.05, 0, 1);
    const phaseRecoveryCredit = clamp((phaseShare - 0.08) / 0.05, 0, 1);
    const trustSlack = clamp((0.18 - trustShare) / 0.08, 0, 1);
    let l2Overhang = 0;
    if (activeLayerName === 'L2') {
      const recentL1 = absoluteTimeWindow.countNotes({ layer: 'L1', windowSeconds: 8 });
      const recentL2 = absoluteTimeWindow.countNotes({ layer: 'L2', windowSeconds: 8 });
      if (recentL2 > recentL1) {
        l2Overhang = clamp((recentL2 - recentL1) / m.max(recentL1, 1), 0, 1.5);
      }
    }
    const lowPhasePressure = clamp((0.05 - phaseShare) / 0.05, 0, 1);
    let layerBias = (activeLayerName === 'L2')
      ? (0.10 + (!dynamicRoleSwap.getIsSwapped() && activeRegime === 'exploring' ? 0.03 : 0)) * (1 - clamp(l2Overhang * 0.22 + lowPhasePressure * 0.08 + recoveryContainmentPressure * 0.16, 0, 0.44))
      : (activeLayerName === 'L1' && activeProfileName === 'explosive'
        ? clamp(0.04 + lowPhasePressure * 0.10 + recoveryContainmentPressure * 0.03 + (activeRegime === 'exploring' ? 0.01 : 0), 0, 0.18)
        : 0);
    if (activeLayerName === 'L2' && phaseRecoveryCredit > 0.15 && evolvingRecoveryPressure > 0.25) {
      layerBias += clamp((0.02 + phaseRecoveryCredit * 0.035 + trustSlack * 0.015 + evolvingRecoveryPressure * 0.04) * (1 - recoveryContainmentPressure * 0.55), 0, 0.08);
    } else if (activeLayerName === 'L1' && activeRegime === 'coherent' && phaseRecoveryCredit > 0.20 && evolvingRecoveryPressure > 0.25) {
      layerBias += clamp(0.01 + evolvingRecoveryPressure * 0.025 + trustSlack * 0.01 - recoveryContainmentPressure * 0.015, 0, 0.04);
    }

    dynamismEngineResolveCacheKey = cacheKey;
    dynamismEngineResolveCacheValue = {
      phraseCtx,
      base,
      phraseEnergy,
      journeyEnergy,
      feedbackEnergy,
      weights,
      playBase,
      playScale,
      stutterBase,
      stutterScale,
      journeyBoost,
      feedbackBoost,
      layerBiasScale,
      layerBias
    };
    return dynamismEngineResolveCacheValue;
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

    const ctx = getBeatStableResolveContext();
    const base = ctx.base;
    const inputPlay = V.optionalFinite(opts.playProb, base.playProb);
    const inputStutter = V.optionalFinite(opts.stutterProb, base.stutterProb);

    const phraseEnergy = ctx.phraseEnergy;
    const journeyEnergy = ctx.journeyEnergy;
    const feedbackEnergy = ctx.feedbackEnergy;
    const pulseEnergy = getUnitPulse(unit);

    const weights = ctx.weights;
    const composite = clamp(V.optionalFinite(
      phraseEnergy * weights.phrase +
      journeyEnergy * weights.journey +
      feedbackEnergy * weights.feedback +
      pulseEnergy * weights.pulse,
      phraseEnergy
    ), 0, 1);

    const rawPlayOut = inputPlay * (ctx.playBase + composite * ctx.playScale) + ctx.layerBias * 0.5 * ctx.layerBiasScale;
    const rawStutterOut = inputStutter * (ctx.stutterBase + composite * ctx.stutterScale) + journeyEnergy * ctx.journeyBoost + feedbackEnergy * ctx.feedbackBoost + ctx.layerBias * ctx.layerBiasScale;
    const playOut = clamp(V.optionalFinite(rawPlayOut, inputPlay), 0.02, 0.98);
    const stutterOut = clamp(V.optionalFinite(rawStutterOut, inputStutter), 0.01, 0.98);

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
