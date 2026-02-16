// src/composers/DynamismEngine.js - Unified probability modulation for note emission
// Combines phrase arc, harmonic journey tension, and feedback intensity into per-unit play/stutter probabilities.

DynamismEngine = (() => {
  const moveBias = {
    origin: 0,
    hold: 0,
    'return-home': 0.1
  };

  /**
   * Get phrase context from the shared PhraseArcManager or a deterministic fallback.
   * @returns {{dynamism:number, atStart:boolean, atEnd:boolean}}
   */
  function getPhraseContext() {
    if (typeof ComposerFactory !== 'undefined' && ComposerFactory && ComposerFactory.sharedPhraseArcManager && typeof ComposerFactory.sharedPhraseArcManager.getPhraseContext === 'function') {
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
    if (typeof HarmonicJourney === 'undefined' || !HarmonicJourney || typeof HarmonicJourney.getStop !== 'function') {
      return 0;
    }
    if (!Number.isFinite(Number(sectionIndex))) {
      return 0;
    }

    const stop = HarmonicJourney.getStop(Number(sectionIndex));
    if (!stop || typeof stop !== 'object') {
      throw new Error('DynamismEngine.getJourneyEnergy: invalid HarmonicJourney stop');
    }

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
    const fxEnergy = (typeof FXFeedbackListener !== 'undefined' && FXFeedbackListener && typeof FXFeedbackListener.getIntensity === 'function')
      ? clamp(Number(FXFeedbackListener.getIntensity()), 0, 1)
      : 0;

    // Use layer-aware stutter intensity (map L1->source, L2->reflection)
    let stutterLayerIntensity = 0;
    try {
      const layerMap = { L1: 'source', L2: 'reflection' };
      const layerProfile = (typeof LM !== 'undefined' && LM && typeof LM.activeLayer === 'string') ? layerMap[LM.activeLayer] : null;
      if (layerProfile && typeof StutterFeedbackListener !== 'undefined' && StutterFeedbackListener && typeof StutterFeedbackListener.getIntensity === 'function') {
        stutterLayerIntensity = clamp(Number(StutterFeedbackListener.getIntensity(layerProfile)), 0, 1);
      }
    } catch { stutterLayerIntensity = 0; }

    const stutterOverall = (typeof StutterFeedbackListener !== 'undefined' && StutterFeedbackListener && typeof StutterFeedbackListener.getIntensity === 'function')
      ? clamp(Number(StutterFeedbackListener.getIntensity()), 0, 1)
      : 0;

    const stutterEnergy = clamp(stutterLayerIntensity * 0.7 + stutterOverall * 0.3, 0, 1);

    const journeyRhythmEnergy = (typeof JourneyRhythmCoupler !== 'undefined' && JourneyRhythmCoupler && typeof JourneyRhythmCoupler.getBoldness === 'function')
      ? clamp(Number(JourneyRhythmCoupler.getBoldness()), 0, 1)
      : 0;

    // Mix FX + Stutter + Journey energy (conservative weighting)
    return clamp(fxEnergy * 0.45 + stutterEnergy * 0.20 + journeyRhythmEnergy * 0.35, 0, 1);
  }

  /**
   * Local per-unit pulse so probabilities evolve inside a measure.
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

    return clamp(measureProgress * 0.35 + beatProgress * 0.35 + osc * 0.3, 0, 1);
  }

  /**
   * Resolve per-unit play/stutter probabilities.
   * @param {'beat'|'div'|'subdiv'|'subsubdiv'} unit
   * @param {{playProb?:number, stutterProb?:number}} [opts]
   * @returns {{playProb:number, stutterProb:number, composite:number}}
   */
  function resolve(unit, opts = {}) {
    if (typeof unit !== 'string' || unit.length === 0) {
      throw new Error('DynamismEngine.resolve: unit must be a non-empty string');
    }

    const phraseCtx = getPhraseContext();
    const base = getBaseProbs(phraseCtx);
    const inputPlay = Number.isFinite(Number(opts.playProb)) ? Number(opts.playProb) : base.playProb;
    const inputStutter = Number.isFinite(Number(opts.stutterProb)) ? Number(opts.stutterProb) : base.stutterProb;

    const phraseEnergy = clamp(Number(phraseCtx.dynamism), 0, 1);
    const journeyEnergy = getJourneyEnergy();
    const feedbackEnergy = getFeedbackEnergy();
    const pulseEnergy = getUnitPulse(unit);

    const composite = clamp(
      phraseEnergy * 0.4 +
      journeyEnergy * 0.25 +
      feedbackEnergy * 0.2 +
      pulseEnergy * 0.15,
      0,
      1
    );

    const layerBias = (typeof LM !== 'undefined' && LM && LM.activeLayer === 'L2') ? 0.04 : 0;
    const playOut = clamp(inputPlay * (0.72 + composite * 0.9) + layerBias * 0.5, 0.02, 0.98);
    const stutterOut = clamp(
      inputStutter * (0.6 + composite * 1.15) +
      journeyEnergy * 0.08 +
      feedbackEnergy * 0.08 +
      layerBias,
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
