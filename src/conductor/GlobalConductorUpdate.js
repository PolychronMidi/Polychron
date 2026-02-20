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
    const absTime = (typeof beatStartTime !== 'undefined' && Number.isFinite(Number(beatStartTime))) ? Number(beatStartTime) : 0;

    // 1. gather context
    const phraseCtx = (typeof ComposerFactory !== 'undefined' && ComposerFactory.sharedPhraseArcManager)
      ? ComposerFactory.sharedPhraseArcManager.getPhraseContext()
      : { dynamism: 0.7, position: 0.5, atStart: false, atEnd: false };

    const harmonicTension = (typeof HarmonicContext !== 'undefined' && HarmonicContext && typeof HarmonicContext.getField === 'function')
      ? (HarmonicContext.getField('tension') || 0)
      : 0;

    const sectionPhase = (typeof HarmonicContext !== 'undefined' && HarmonicContext.getField && HarmonicContext.getField('sectionPhase'))
      || 'development';
    const excursion = (typeof HarmonicContext !== 'undefined' && HarmonicContext.getField && HarmonicContext.getField('excursion'))
      || 0;

    // 2. derive composite intensity (0-1)
    const phaseMult = ConductorConfig.getPhaseMultiplier(sectionPhase);
    const arcIntensity = phraseCtx.dynamism * phaseMult;
    const excursionTension = Math.min(excursion, 6) * 0.05;
    const tensionIntensity = harmonicTension + excursionTension;

    const harmonicRhythm = (typeof HarmonicRhythmTracker !== 'undefined' && HarmonicRhythmTracker && typeof HarmonicRhythmTracker.getHarmonicRhythm === 'function')
      ? clamp(Number(HarmonicRhythmTracker.getHarmonicRhythm()), 0, 1)
      : 0;
    const harmonicRhythmParams = (typeof ConductorConfig !== 'undefined' && ConductorConfig && typeof ConductorConfig.getHarmonicRhythmParams === 'function')
      ? ConductorConfig.getHarmonicRhythmParams()
      : { blendWeight: 0.15, feedbackWeight: 0.2 };
    const harmonicRhythmWeight = clamp(Number(harmonicRhythmParams.blendWeight), 0, 0.5);
    const intensityBlend = (typeof ConductorConfig !== 'undefined' && ConductorConfig && typeof ConductorConfig.getGlobalIntensityBlend === 'function')
      ? ConductorConfig.getGlobalIntensityBlend()
      : { arc: 0.6, tension: 0.4 };
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

    // 4. Collect density bias from registry
    const registryDensityBias = ConductorIntelligence.collectDensityBias();

    // Coherence + emission density corrections (not registry-managed — core pipeline)
    const coherenceDensityBias = (typeof LayerCoherenceScorer !== 'undefined' && LayerCoherenceScorer && typeof LayerCoherenceScorer.getDensityBias === 'function')
      ? LayerCoherenceScorer.getDensityBias()
      : 1;
    const emissionRatio = (typeof EmissionFeedbackListener !== 'undefined' && EmissionFeedbackListener && typeof EmissionFeedbackListener.getEmissionRatio === 'function')
      ? clamp(Number(EmissionFeedbackListener.getEmissionRatio()), 0, 2)
      : 1;
    const densityCorrection = clamp(1 + clamp(1 - emissionRatio, -1, 1) * 0.2, 0.8, 1.25);

    // Drive motif density
    const targetDensity = clamp(
      ConductorConfig.getTargetDensity(compositeIntensity) * densityCorrection * coherenceDensityBias * registryDensityBias,
      0, 1
    );
    const smooth = ConductorConfig.getDensitySmoothing();
    currentDensity = currentDensity * (1 - smooth) + targetDensity * smooth;

    // 5. Micro-hyper density flicker
    const textureDensityBoost = (typeof DrumTextureCoupler !== 'undefined' && DrumTextureCoupler && typeof DrumTextureCoupler.getIntensity === 'function')
      ? clamp(Number(DrumTextureCoupler.getIntensity()), 0, 1) * 0.5
      : 0;
    const registryFlickerMod = ConductorIntelligence.collectFlickerModifier();
    const flickerAmplitude = (compositeIntensity + textureDensityBoost) * registryFlickerMod;
    const densitySeed = (Number.isFinite(Number(beatStart)) ? Number(beatStart) : 0);
    const densityFlicker = m.sin(densitySeed * 0.0041 + 1.7) * 0.08 * flickerAmplitude
                         + m.sin(densitySeed * 0.0089 - 2.3) * 0.05 * flickerAmplitude
                         + rf(-0.03, 0.03) * flickerAmplitude;
    const densityBounds = ConductorConfig.getDensityBounds();
    const flickeredDensity = clamp(currentDensity + densityFlicker, densityBounds.floor, densityBounds.ceiling);

    if (typeof motifConfig !== 'undefined' && typeof motifConfig.setUnitProfileOverride === 'function') {
      motifConfig.setUnitProfileOverride('div', { intervalDensity: flickeredDensity });
      motifConfig.setUnitProfileOverride('subdiv', { intervalDensity: flickeredDensity * 0.9 });
      motifConfig.setUnitProfileOverride('subsubdiv', { intervalDensity: flickeredDensity * 0.8 });
    }

    // 6. Drive stutter behavior
    if (typeof Stutter !== 'undefined') {
      const stutterParams = ConductorConfig.getStutterParams(compositeIntensity);
      if (typeof Stutter.setDefaultDirective === 'function') {
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
      }
    }

    // 7. DynamismEngine probability calculation
    if (typeof DynamismEngine === 'undefined' || !DynamismEngine || typeof DynamismEngine.resolve !== 'function') {
      throw new Error('GlobalConductor.update: DynamismEngine.resolve is not available');
    }
    const resolved = DynamismEngine.resolve('beat');

    // 8. Collect tension bias from registry
    const registryTensionBias = ConductorIntelligence.collectTensionBias();
    const derivedTension = clamp(
      (Number(resolved.composite) * 0.7 + Number(harmonicTension) * 0.3) * registryTensionBias,
      0, 1
    );
    if (typeof HarmonicContext !== 'undefined' && HarmonicContext && typeof HarmonicContext.set === 'function') {
      HarmonicContext.set({ tension: derivedTension });
    }

    let playOut = resolved.playProb;
    let stutterOut = resolved.stutterProb;

    if (sectionPhase === 'climax') {
      const boost = ConductorConfig.getClimaxBoost();
      playOut = clamp(resolved.playProb * boost.playScale, 0, 1);
      stutterOut = clamp(resolved.stutterProb * boost.stutterScale, 0, 1);
    }

    // 9. Collect state fields from registry + core pipeline fields
    if (typeof ConductorState !== 'undefined' && ConductorState && typeof ConductorState.updateFromConductor === 'function') {
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
        stutterProb: stutterOut
      }));
    }

    return {
      playProb: playOut,
      stutterProb: stutterOut
    };
  }

})();
