// GlobalConductor.js - Orchestrates system-wide coherence and dynamicism
// Readings from HarmonincContext and PhraseArcManager drive:
// - Motif density (via motifConfig overrides)
// - Stutter intensity/rate (via StutterManager directives)
// - Play probabilities (returned to main loop)

GlobalConductor = (() => {
  // State for smoothing transitions
  let currentDensity = 0.5;

  /**
   * Update all dynamic systems based on current musical context.
   * Call once per beat (or measure) from main loop.
   * @returns {{ playProb: number, stutterProb: number }}
   */
  function update() {
    // 1. gather context
    const phraseCtx = (typeof ComposerFactory !== 'undefined' && ComposerFactory.sharedPhraseArcManager)
      ? ComposerFactory.sharedPhraseArcManager.getPhraseContext()
      : { dynamism: 0.7, position: 0.5, atStart: false, atEnd: false };

    // Safety check for HarmonicContext
    const harmonicTension = (typeof HarmonicContext !== 'undefined' && HarmonicContext && typeof HarmonicContext.getField === 'function')
      ? (HarmonicContext.getField('tension') || 0)
      : 0;

    // READ NEW CONTEXT: Structural Phase & Excursion
    // These drive macro-dynamics (long-term arcs) vs phraseCtx (mid-term)
    const sectionPhase = (typeof HarmonicContext !== 'undefined' && HarmonicContext.getField && HarmonicContext.getField('sectionPhase'))
      || 'development';
    const excursion = (typeof HarmonicContext !== 'undefined' && HarmonicContext.getField && HarmonicContext.getField('excursion'))
      || 0;

    // 2. derive composite intensity (0-1)
    // Intensity rises with phrase position, harmonic tension, and structural drama

    // Calculate Phase Multiplier (Macro-dynamics) — profile-driven
    const phaseMult = ConductorConfig.getPhaseMultiplier(sectionPhase);

    // Apply multiplier to the raw arc dynamism from PhraseArcManager
    const arcIntensity = phraseCtx.dynamism * phaseMult;

    // Calculate Excursion Tension (0-6 semitones -> 0-0.3)
    // Further from home = more unstable/intense
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

    const emissionRatio = (typeof EmissionFeedbackListener !== 'undefined' && EmissionFeedbackListener && typeof EmissionFeedbackListener.getEmissionRatio === 'function')
      ? clamp(Number(EmissionFeedbackListener.getEmissionRatio()), 0, 2)
      : 1;
    const densityCorrection = clamp(1 + clamp(1 - emissionRatio, -1, 1) * 0.2, 0.8, 1.25);

    // 3. Drive Motif Density (Coherence: High tension -> denser motifs)
    // Smoothly interpolate towards target density, then apply micro-hyper
    // flicker so density itself oscillates within a beat (Step 4)
    const targetDensity = clamp(ConductorConfig.getTargetDensity(compositeIntensity) * densityCorrection, 0, 1);
    const smooth = ConductorConfig.getDensitySmoothing();
    currentDensity = currentDensity * (1 - smooth) + targetDensity * smooth;

    // Micro-hyper density flicker: density oscillates per-beat so some
    // subsubdivs get many note options (dense run territory) while others
    // get very few (sparse, exposed).  Amplitude scales with compositeIntensity
    // so calm sections stay stable and intense sections shimmer.
    // Texture intensity (#7): high texture activity → wider flicker amplitude
    // so motifConfig density oscillates more dramatically during texture-rich passages.
    const textureDensityBoost = (typeof DrumTextureCoupler !== 'undefined' && DrumTextureCoupler && typeof DrumTextureCoupler.getIntensity === 'function')
      ? clamp(Number(DrumTextureCoupler.getIntensity()), 0, 1) * 0.5
      : 0;
    const flickerAmplitude = compositeIntensity + textureDensityBoost;
    const densitySeed = (Number.isFinite(Number(beatStart)) ? Number(beatStart) : 0);
    const densityFlicker = m.sin(densitySeed * 0.0041 + 1.7) * 0.08 * flickerAmplitude
                         + m.sin(densitySeed * 0.0089 - 2.3) * 0.05 * flickerAmplitude
                         + rf(-0.03, 0.03) * flickerAmplitude;
    const densityBounds = ConductorConfig.getDensityBounds();
    const flickeredDensity = clamp(currentDensity + densityFlicker, densityBounds.floor, densityBounds.ceiling);

    if (typeof motifConfig !== 'undefined' && typeof motifConfig.setUnitProfileOverride === 'function') {
      // Apply flickered density to deeper units for texture buildup
      motifConfig.setUnitProfileOverride('div', { intervalDensity: flickeredDensity });
      motifConfig.setUnitProfileOverride('subdiv', { intervalDensity: flickeredDensity * 0.9 });
      motifConfig.setUnitProfileOverride('subsubdiv', { intervalDensity: flickeredDensity * 0.8 });
    }

    // 4. Drive Stutter Behavior (Dynamicism: High intensity -> faster, more chaotic stutters)
    if (typeof Stutter !== 'undefined') {
      // Profile-driven stutter params
      const stutterParams = ConductorConfig.getStutterParams(compositeIntensity);

      // Update default directive for spontaneous stutters
      if (typeof Stutter.setDefaultDirective === 'function') {
        Stutter.setDefaultDirective({
          rate: stutterParams.rate,
          rateCurve: stutterParams.rateCurve,
          phase: {
            left: 0,
            right: 0.5 + 0.2 * compositeIntensity, // wider stereo width with intensity
            center: 0
          },
          coherence: {
            enabled: true, // Always enable coherence for musicality
            mode: stutterParams.coherenceMode
          }
        });
      }
    }

    // 5. Delegate probability calculation to DynamismEngine (single authority)
    // GlobalConductor provides macro context (motif density, stutter directives above);
    // DynamismEngine is the sole probability calculator to avoid double-modulation.
    if (typeof DynamismEngine === 'undefined' || !DynamismEngine || typeof DynamismEngine.resolve !== 'function') {
      throw new Error('GlobalConductor.update: DynamismEngine.resolve is not available');
    }
    const resolved = DynamismEngine.resolve('beat');

    const derivedTension = clamp(Number(resolved.composite) * 0.7 + Number(harmonicTension) * 0.3, 0, 1);
    if (typeof HarmonicContext !== 'undefined' && HarmonicContext && typeof HarmonicContext.set === 'function') {
      HarmonicContext.set({ tension: derivedTension });
    }

    let playOut = resolved.playProb;
    let stutterOut = resolved.stutterProb;

    // Apply climax boost on top of DynamismEngine's output (profile-driven)
    if (sectionPhase === 'climax') {
      const boost = ConductorConfig.getClimaxBoost();
      playOut = clamp(resolved.playProb * boost.playScale, 0, 1);
      stutterOut = clamp(resolved.stutterProb * boost.stutterScale, 0, 1);
    }

    if (typeof ConductorState !== 'undefined' && ConductorState && typeof ConductorState.updateFromConductor === 'function') {
      ConductorState.updateFromConductor({
        phraseCtx,
        sectionPhase,
        tension: derivedTension,
        excursion,
        harmonicRhythm,
        emissionRatio,
        compositeIntensity: resolved.composite,
        playProb: playOut,
        stutterProb: stutterOut
      });
    }

    return {
      playProb: playOut,
      stutterProb: stutterOut
    };
  }

  return { update };
})();
