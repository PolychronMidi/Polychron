/**
 * GlobalConductorUpdate.js
 * Extracted update function from GlobalConductor.js to reduce file size.
 * Uses ConductorIntelligence registry to collect biases/signals from
 * intelligence modules instead of probing 70+ typeof guards.
 */

(function() {

  /**
   * Update all dynamic systems based on current musical context.
   * Call once per beat (or measure) from main loop.
   * @returns {{ playProb: number, stutterProb: number }}
   */
  update = function() {
    // Compute absolute time once for all recorder calls
    const absTime = Number(beatStartTime);

    // 1. gather context (all globals boot-validated — no typeof guards needed)
    const phraseCtx = ComposerFactory.sharedPhraseArcManager.getPhraseContext();

    const harmonicTension = HarmonicContext.getField('tension');

    const sectionPhase = HarmonicContext.getField('sectionPhase');
    const excursion = HarmonicContext.getField('excursion');

    // 2. derive composite intensity (0-1)
    const phaseMult = ConductorConfig.getPhaseMultiplier(sectionPhase);
    const arcIntensity = phraseCtx.dynamism * phaseMult;
    const excursionTension = Math.min(excursion, 6) * 0.05;
    const tensionIntensity = harmonicTension + excursionTension;

    const harmonicRhythm = clamp(Number(HarmonicRhythmTracker.getHarmonicRhythm()), 0, 1);
    const harmonicRhythmParams = ConductorConfig.getHarmonicRhythmParams();
    const harmonicRhythmWeight = clamp(Number(harmonicRhythmParams.blendWeight), 0, 0.5);
    const intensityBlend = ConductorConfig.getGlobalIntensityBlend();
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
    ConductorIntelligence.runRecorders({
      absTime,
      compositeIntensity,
      currentDensity,
      harmonicRhythm
    });

    // 4. Collect density bias from registry (attributed for signal decomposition)
    const densityAttr = ConductorIntelligence.collectDensityBiasWithAttribution();
    const registryDensityBias = densityAttr.product;

    // Coherence + emission density corrections (boot-validated globals — direct calls)
    const coherenceDensityBias = LayerCoherenceScorer.getDensityBias();
    const emissionRatio = clamp(Number(EmissionFeedbackListener.getEmissionRatio()), 0, 2);
    const densityCorrection = clamp(1 + clamp(1 - emissionRatio, -1, 1) * 0.2, 0.8, 1.25);

    // Drive motif density
    const targetDensity = clamp(
      ConductorConfig.getTargetDensity(compositeIntensity) * densityCorrection * coherenceDensityBias * registryDensityBias,
      0, 1
    );
    const smooth = ConductorConfig.getDensitySmoothing();
    currentDensity = currentDensity * (1 - smooth) + targetDensity * smooth;

    // 5. Micro-hyper density flicker (attributed)
    const textureDensityBoost = clamp(Number(DrumTextureCoupler.getIntensity()), 0, 1) * 0.5;
    const flickerAttr = ConductorIntelligence.collectFlickerModifierWithAttribution();
    const registryFlickerMod = flickerAttr.product;
    const flickerAmplitude = (compositeIntensity + textureDensityBoost) * registryFlickerMod;
    const densitySeed = Number(beatStart);
    const densityFlicker = m.sin(densitySeed * 0.0041 + 1.7) * 0.08 * flickerAmplitude
                         + m.sin(densitySeed * 0.0089 - 2.3) * 0.05 * flickerAmplitude
                         + rf(-0.03, 0.03) * flickerAmplitude;
    const densityBounds = ConductorConfig.getDensityBounds();
    const flickeredDensity = clamp(currentDensity + densityFlicker, densityBounds.floor, densityBounds.ceiling);

    motifConfig.setUnitProfileOverride('div', { intervalDensity: flickeredDensity });
    motifConfig.setUnitProfileOverride('subdiv', { intervalDensity: flickeredDensity * 0.9 });
    motifConfig.setUnitProfileOverride('subsubdiv', { intervalDensity: flickeredDensity * 0.8 });

    // 6. Drive stutter behavior
    const stutterParams = ConductorConfig.getStutterParams(compositeIntensity);
    Stutter.setDefaultDirective({
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

    // 7. DynamismEngine probability calculation
    const resolved = DynamismEngine.resolve('beat');

    // 8. Collect tension bias from registry (attributed)
    // Temporal smoothing: density has EMA via getDensitySmoothing(),
    // but tension had none — contributing to the oscillating regime.
    // Small smoothing factor (0.25) reduces beat-to-beat reversals.
    const tensionAttr = ConductorIntelligence.collectTensionBiasWithAttribution();
    const registryTensionBias = tensionAttr.product;
    const rawTension = clamp(
      (Number(resolved.composite) * 0.7 + Number(harmonicTension) * 0.3) * registryTensionBias,
      0, 1
    );
    const TENSION_SMOOTHING = 0.12;
    const prevTension = HarmonicContext.getField('tension');
    const derivedTension = prevTension * (1 - TENSION_SMOOTHING) + rawTension * TENSION_SMOOTHING;
    HarmonicContext.set({ tension: derivedTension });

    let playOut = resolved.playProb;
    let stutterOut = resolved.stutterProb;

    if (sectionPhase === 'climax') {
      const boost = ConductorConfig.getClimaxBoost();
      playOut = clamp(resolved.playProb * boost.playScale, 0, 1);
      stutterOut = clamp(resolved.stutterProb * boost.stutterScale, 0, 1);
    }

    // 9. Collect state fields from registry + core pipeline fields + attribution
    const registryFields = ConductorIntelligence.collectStateFields();
    ConductorState.updateFromConductor(Object.assign(registryFields, {
      phraseCtx,
      sectionPhase,
      tension: derivedTension,
      excursion,
      harmonicRhythm,
      emissionRatio,
      compositeIntensity: resolved.composite,
      playProb: playOut,
      stutterProb: stutterOut,
      densityAttribution: densityAttr.contributions,
      tensionAttribution: tensionAttr.contributions,
      flickerAttribution: flickerAttr.contributions
    }));

    return {
      playProb: playOut,
      stutterProb: stutterOut
    };
  }

})();
