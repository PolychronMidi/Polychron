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

    if (!ConductorConfig || typeof ConductorConfig.getFeedbackMixWeights !== 'function' || typeof ConductorConfig.getEnergyWeights !== 'function') {
      throw new Error('DynamismEngine: ConductorConfig energy accessors are required');
    }
    if (!FXFeedbackListener || typeof FXFeedbackListener.getIntensity !== 'function') {
      throw new Error('DynamismEngine: FXFeedbackListener.getIntensity is required');
    }
    if (!StutterFeedbackListener || typeof StutterFeedbackListener.getIntensity !== 'function') {
      throw new Error('DynamismEngine: StutterFeedbackListener.getIntensity is required');
    }
    if (!JourneyRhythmCoupler || typeof JourneyRhythmCoupler.getBoldness !== 'function') {
      throw new Error('DynamismEngine: JourneyRhythmCoupler.getBoldness is required');
    }
    if (!TextureBlender || typeof TextureBlender.getRecentDensity !== 'function') {
      throw new Error('DynamismEngine: TextureBlender.getRecentDensity is required');
    }
    if (!HarmonicJourney || typeof HarmonicJourney.getStop !== 'function') {
      throw new Error('DynamismEngine: HarmonicJourney.getStop is required');
    }
    V.requireDefined(LM, 'LM');
    V.assertObject(LM, 'LM');

    dependenciesValidated = true;
  }

  /**
   * Get phrase context from the shared PhraseArcManager or a deterministic fallback.
   * @returns {{dynamism:number, atStart:boolean, atEnd:boolean}}
   */
  function getPhraseContext() {
    if (ComposerFactory && ComposerFactory.sharedPhraseArcManager && ComposerFactory.sharedPhraseArcManager.getPhraseContext) {
      return ComposerFactory.sharedPhraseArcManager.getPhraseContext();
    }
    return { dynamism: 0.7, atStart: false, atEnd: false };
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
    const layerProfile = (typeof LM.activeLayer === 'string') ? layerMap[LM.activeLayer] : null;
    const stutterLayerIntensity = layerProfile
      ? clamp(Number(StutterFeedbackListener.getIntensity(layerProfile)), 0, 1)
      : 0;

    const stutterOverall = clamp(Number(StutterFeedbackListener.getIntensity()), 0, 1);

    const stutterEnergy = clamp(stutterLayerIntensity * 0.7 + stutterOverall * 0.3, 0, 1);

    const journeyRhythmEnergy = clamp(Number(JourneyRhythmCoupler.getBoldness()), 0, 1);

    const textureEnergy = clamp(Number(TextureBlender.getRecentDensity()), 0, 1) * 0.15;

    const harmonicRhythmParams = (typeof ConductorConfig.getHarmonicRhythmParams === 'function')
      ? ConductorConfig.getHarmonicRhythmParams()
      : { blendWeight: 0.15, feedbackWeight: 0.2 };
    const harmonicRhythmWeight = clamp(Number(harmonicRhythmParams.feedbackWeight), 0, 0.5);
    const harmonicRhythmEnergy = (HarmonicRhythmTracker && typeof HarmonicRhythmTracker.getHarmonicRhythm === 'function')
      ? clamp(Number(HarmonicRhythmTracker.getHarmonicRhythm()), 0, 1) * harmonicRhythmWeight
      : 0;

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
   * Now includes micro-hyper oscillation: two incommensurate fast sine
   * layers + random spike whose amplitude scales with unit depth and
   * crossModulation feedback (Step 1 + Step 5 integration).
   * @param {'beat'|'div'|'subdiv'|'subsubdiv'} unit
   * @returns {number} 0-1
   */
  function getUnitPulse(unit) {
    const measureProgress = (Number.isFinite(Number(measuresPerPhrase)) && Number(measuresPerPhrase) > 0 && Number.isFinite(Number(measureIndex)))
      ? clamp(Number(measureIndex) / Number(measuresPerPhrase), 0, 1)
      : 0;
    const beatProgress = (Number.isFinite(Number(numerator)) && Number(numerator) > 0 && Number.isFinite(Number(beatIndex)))
      ? clamp(Number(beatIndex) / Number(numerator), 0, 1)
      : 0;

    const unitPhase = unit === 'beat' ? 0 : unit === 'div' ? 1.1 : unit === 'subdiv' ? 2.2 : 3.3;
    const unitSeed = Number.isFinite(Number(unitStart)) ? Number(unitStart) : (measureProgress * 137 + beatProgress * 89);
    const osc = (m.sin(unitSeed * 0.0009 + unitPhase) + 1) * 0.5;

    const basePulse = measureProgress * 0.35 + beatProgress * 0.35 + osc * 0.3;

    // ── Micro-hyper flicker (depth-scaled, profile-driven) ─────────
    // Amplitude increases for finer units: beat=0, div=small, subdiv=med, subsubdiv=large
    const baseDepthAmp = unit === 'beat' ? 0 : unit === 'div' ? 0.08 : unit === 'subdiv' ? 0.14 : 0.22;
    const flickerProfile = ConductorConfig.getFlickerParams();
    const depthAmp = baseDepthAmp * flickerProfile.depthScale;

    // Scale flicker amplitude with crossModulation feedback (Step 5):
    // dense rhythmic activity → wider flicker → more textural contrast
    const crossModAmp = (Number.isFinite(crossModulation))
      ? clamp(crossModulation / 6, 0, 1) // crossMod typically ranges ~0–6
      : flickerProfile.crossModWeight;
    const flickerScale = depthAmp * (0.5 + 0.5 * crossModAmp);

    // Two incommensurate noise samples for organic non-repeating flicker (#6)
    // Uses defaultSimplex (noise subsystem) when available; falls back to sine
    const useNoise = defaultSimplex && typeof defaultSimplex.noise === 'function';
    const flicker1 = useNoise
      ? defaultSimplex.noise(unitSeed * 0.0037, unitPhase * 2.7) * flickerScale
      : m.sin(unitSeed * 0.0037 + unitPhase * 2.7) * flickerScale;
    const flicker2 = useNoise
      ? defaultSimplex.noise(unitSeed * 0.0071, -unitPhase * 4.1) * flickerScale * 0.7
      : m.sin(unitSeed * 0.0071 - unitPhase * 4.1) * flickerScale * 0.7;
    const spike = rf(-1, 1) * flickerScale * 0.4;

    return clamp(basePulse + flicker1 + flicker2 + spike, 0, 1);
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
    const inputPlay = Number.isFinite(Number(opts.playProb)) ? Number(opts.playProb) : base.playProb;
    const inputStutter = Number.isFinite(Number(opts.stutterProb)) ? Number(opts.stutterProb) : base.stutterProb;

    const phraseEnergy = clamp(Number(phraseCtx.dynamism), 0, 1);
    const journeyEnergy = getJourneyEnergy();
    const feedbackEnergy = getFeedbackEnergy();
    const pulseEnergy = getUnitPulse(unit);

    const weights = ConductorConfig.getEnergyWeights();
    const composite = clamp(
      phraseEnergy * weights.phrase +
      journeyEnergy * weights.journey +
      feedbackEnergy * weights.feedback +
      pulseEnergy * weights.pulse,
      0,
      1
    );

    const emissionGate = (ConductorConfig && typeof ConductorConfig.getEmissionGateParams === 'function')
      ? ConductorConfig.getEmissionGateParams()
      : {
          playBase: 0.72,
          playScale: 0.9,
          stutterBase: 0.6,
          stutterScale: 1.15,
          journeyBoost: 0.08,
          feedbackBoost: 0.08,
          layerBiasScale: 1
        };

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
