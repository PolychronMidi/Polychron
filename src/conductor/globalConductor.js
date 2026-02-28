// globalConductor.js - Orchestrates system-wide coherence and dynamicism
// Readings from HarmonicContext and PhraseArcManager drive:
// - Motif density (via motifConfig overrides)
// - stutter intensity/rate (via StutterManager directives)
// - Play probabilities (returned to main loop)

// State for smoothing transitions (naked global for runtime state)
currentDensity = 0.5;

globalConductor = (() => {

  // Flicker modifier EMA state - smooths the amplitude envelope
  // while preserving the per-beat noise pattern.
  let _prevFlickerMod = 1;
  const FLICKER_SMOOTHING = 0.15;

  /**
   * Update all dynamic systems based on current musical context.
   * Call once per beat (or measure) from main loop.
   * @returns {{ playProb: number, stutterProb: number }}
   */
  function update() {
    // Compute absolute time once for all recorder calls
    const absTime = Number(beatStartTime);

    // 1. gather context (all globals boot-validated - no typeof guards needed)
    const phraseCtx = FactoryManager.sharedPhraseArcManager.getPhraseContext();

    const harmonicTension = harmonicContext.getField('tension');

    const sectionPhase = harmonicContext.getField('sectionPhase');
    const excursion = harmonicContext.getField('excursion');

    // 2. derive composite intensity (0-1)
    const phaseMult = conductorConfig.getPhaseMultiplier(sectionPhase);
    const arcIntensity = phraseCtx.dynamism * phaseMult;
    const excursionTension = Math.min(excursion, 6) * 0.05;
    const tensionIntensity = harmonicTension + excursionTension;

    const harmonicRhythm = clamp(Number(harmonicRhythmTracker.getHarmonicRhythm()), 0, 1);
    const harmonicRhythmParams = conductorConfig.getHarmonicRhythmParams();
    const harmonicRhythmWeight = clamp(Number(harmonicRhythmParams.blendWeight), 0, 0.5);
    const intensityBlend = conductorConfig.getGlobalIntensityBlend();
    const baseCompositeIntensity = clamp(
      arcIntensity * intensityBlend.arc + tensionIntensity * intensityBlend.tension,
      0,
      1
    );
    const compositeIntensity = clamp(
      baseCompositeIntensity * (1 - harmonicRhythmWeight) + harmonicRhythm * harmonicRhythmWeight,
      0,
      1
    );

    // 3. Run all registered recorders (side-effect: update intelligence module state)
    conductorIntelligence.runRecorders({
      absTime,
      compositeIntensity,
      currentDensity,
      harmonicRhythm
    });

    // 4. Collect density bias from registry (attributed for signal decomposition)
    const densityAttr = conductorIntelligence.collectDensityBiasWithAttribution();
    const registryDensityBias = densityAttr.product;

    // Coherence + emission density corrections (boot-validated globals - direct calls)
    // layerCoherenceScorer.getDensityBias() now registered in the density registry
    // (attributed, dampened). Only emission correction remains extra-pipeline.
    const emissionRatio = clamp(Number(emissionFeedbackListener.getEmissionRatio()), 0, 2);
    const densityCorrection = clamp(1 + clamp(1 - emissionRatio, -1, 1) * 0.2, 0.8, 1.25);

    // Drive motif density
    const targetDensity = clamp(
      conductorConfig.getTargetDensity(compositeIntensity) * densityCorrection * registryDensityBias,
      0, 1
    );
    const smooth = conductorConfig.getDensitySmoothing();
    currentDensity = currentDensity * (1 - smooth) + targetDensity * smooth;

    // 5. Micro-hyper density flicker (attributed)
    const textureDensityBoost = clamp(Number(drumTextureCoupler.getIntensity()), 0, 1) * 0.5;
    const flickerAttr = conductorIntelligence.collectFlickerModifierWithAttribution();
    // EMA on flicker modifier: smooths the amplitude envelope to reduce
    // beat-to-beat reversals that inflate trajectory curvature, while
    // preserving the per-beat noise pattern (sine + random terms below).
    const rawFlickerMod = flickerAttr.product;
    const registryFlickerMod = _prevFlickerMod * (1 - FLICKER_SMOOTHING) + rawFlickerMod * FLICKER_SMOOTHING;
    _prevFlickerMod = registryFlickerMod;
    // Decoupling: flicker base blends compositeIntensity with harmonicRhythm
    // and a slow independent carrier. This reduces lockstep coupling between
    // density/tension and flicker while preserving macro energy following.
    const densitySeed = Number(beatStart);
    const flickerCarrier = 0.5 + 0.5 * m.sin(densitySeed * 0.0017 + harmonicRhythm * m.PI);
    const flickerBase = clamp(compositeIntensity * 0.35 + harmonicRhythm * 0.25 + flickerCarrier * 0.40, 0, 1.2);
    const flickerAmplitude = (flickerBase + textureDensityBoost) * registryFlickerMod;
    const densityFlicker = m.sin(densitySeed * 0.0041 + 1.7) * 0.08 * flickerAmplitude
                         + m.sin(densitySeed * 0.0089 - 2.3) * 0.05 * flickerAmplitude
                         + rf(-0.03, 0.03) * flickerAmplitude;
    const densityBounds = conductorConfig.getDensityBounds();
    const flickeredDensity = clamp(currentDensity + densityFlicker, densityBounds.floor, densityBounds.ceiling);

    motifConfig.setUnitProfileOverride('div', { intervalDensity: flickeredDensity });
    motifConfig.setUnitProfileOverride('subdiv', { intervalDensity: flickeredDensity * 0.9 });
    motifConfig.setUnitProfileOverride('subsubdiv', { intervalDensity: flickeredDensity * 0.8 });

    // 6. Drive stutter behavior
    const stutterParams = conductorConfig.getStutterParams(compositeIntensity);
    stutter.setDefaultDirective({
      rate: stutterParams.rate,
      rateCurve: stutterParams.rateCurve,
      phase: {
        left: 0,
        right: 0.5 + 0.2 * compositeIntensity,
        center: 0
      },
      coherence: {
        enabled: true,
        mode: stutterParams.coherenceMode
      }
    });

    // 7. dynamismEngine probability calculation
    const resolved = dynamismEngine.resolve('beat');

    // 8. Collect tension bias from registry (attributed)
    // Temporal smoothing: density has EMA via getDensitySmoothing(),
    // but tension had none - contributing to the oscillating regime.
    // Small smoothing factor (0.25) reduces beat-to-beat reversals.
    const tensionAttr = conductorIntelligence.collectTensionBiasWithAttribution();
    const registryTensionBias = tensionAttr.product;
    const rawTension = clamp(
      (Number(resolved.composite) * 0.7 + Number(harmonicTension) * 0.3) * registryTensionBias,
      0, 1
    );
    const TENSION_SMOOTHING = 0.12;
    const prevTension = harmonicContext.getField('tension');
    const derivedTension = prevTension * (1 - TENSION_SMOOTHING) + rawTension * TENSION_SMOOTHING;
    harmonicContext.set({ tension: derivedTension });

    let playOut = resolved.playProb;
    let stutterOut = resolved.stutterProb;

    if (sectionPhase === 'climax') {
      const boost = conductorConfig.getClimaxBoost();
      playOut = clamp(resolved.playProb * boost.playScale, 0, 1);
      stutterOut = clamp(resolved.stutterProb * boost.stutterScale, 0, 1);
    }

    // 9. Collect state fields from registry + core pipeline fields + attribution
    const registryFields = conductorIntelligence.collectStateFields();
    conductorState.updateFromConductor(Object.assign(registryFields, {
      phraseCtx,
      sectionPhase,
      tension: derivedTension,
      excursion,
      harmonicRhythm,
      flicker: registryFlickerMod,
      flickerAmplitude,
      emissionRatio,
      compositeIntensity: resolved.composite,
      playProb: playOut,
      stutterProb: stutterOut,
      densityAttribution: densityAttr.contributions,
      tensionAttribution: tensionAttr.contributions,
      flickerAttribution: flickerAttr.contributions,
      // Extra-pipeline density multipliers - only emission correction remains
      // outside the registry. layerCoherenceScorer is now in-registry (attributed).
      extraDensityCorrection: densityCorrection,
      extraCoherenceDensityBias: 1.0
    }));

    return {
      playProb: playOut,
      stutterProb: stutterOut
    };
  }

  return { update };
})();
