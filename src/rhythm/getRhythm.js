// src/rhythm/getRhythm.js - Rhythm pattern retrieval with dynamic method selection.

let _getRhythmDepsValidated = false;

function assertGetRhythmDeps() {
  if (_getRhythmDepsValidated) return;
  if (!FXFeedbackListener || !FXFeedbackListener.biasRhythmWeights) {
    throw new Error('getRhythm: FXFeedbackListener.biasRhythmWeights is required');
  }
  if (!StutterFeedbackListener || !StutterFeedbackListener.biasRhythmWeights) {
    throw new Error('getRhythm: StutterFeedbackListener.biasRhythmWeights is required');
  }
  if (!JourneyRhythmCoupler || !JourneyRhythmCoupler.biasRhythmWeights) {
    throw new Error('getRhythm: JourneyRhythmCoupler.biasRhythmWeights is required');
  }
  if (!PhaseLockedRhythmGenerator || !PhaseLockedRhythmGenerator.generate) {
    throw new Error('getRhythm: PhaseLockedRhythmGenerator.generate is required');
  }
  _getRhythmDepsValidated = true;
}

const V = Validator.create('getRhythm');

getRhythm = function getRhythm(level,length,pattern,method,...args){
  assertGetRhythmDeps();
  V.assertNonEmptyString(level, 'level');
  V.requireFinite(length, 'length');
  // Map subsubdiv to subdiv's level index so subsubdiv rhythm selection reuses subdiv candidates
  const levelIndex = (level === 'subsubdiv' ? 2 : ['beat','div','subdiv'].indexOf(level));

  if (method) {
    // Phase-locked path: length-only patterns can be generated with phase cohesion
    if (args && args.length === 1 && args[0] === length) {
      return PhaseLockedRhythmGenerator.generate(length, method);
    }
    // Fail-fast: delegate to RhythmRegistry, which will throw if method not found
    return RhythmRegistry.execute(method, ...args);
  } else {
    const fxBiasedRhythmSource = FXFeedbackListener.biasRhythmWeights(rhythms);

    // Also apply stutter-based rhythm bias if available
    const stutterBiasedRhythmSource = StutterFeedbackListener.biasRhythmWeights(fxBiasedRhythmSource);

    // Chain journey-boldness bias on top of FX+Stutter bias
    let rhythmSource = JourneyRhythmCoupler.biasRhythmWeights(stutterBiasedRhythmSource);

    // Apply rhythm history novelty penalty to discourage repetition
    rhythmSource = RhythmHistoryTracker.penalizeRepetition(rhythmSource);

    const hasLayerContext = LM && typeof LM.activeLayer === 'string' && LM.activeLayer.length > 0;
    const activeComposer = hasLayerContext ? LM.getComposerFor(LM.activeLayer) : null;
    const useCorpusRhythmPriors = Boolean(activeComposer && activeComposer.useCorpusRhythmPriors === true);

    if (useCorpusRhythmPriors) {
      const phraseContext = ComposerFactory.sharedPhraseArcManager.getPhraseContext();

      rhythmSource = rhythmPriors.getBiasedRhythms({
        rhythms: fxBiasedRhythmSource,
        level,
        phase: (phraseContext && typeof phraseContext.phase === 'string' && phraseContext.phase.length > 0) ? phraseContext.phase : undefined,
        phraseContext,
        atBoundary: Boolean(phraseContext && phraseContext.atBoundary === true),
        quality: (activeComposer && typeof activeComposer.quality === 'string' && activeComposer.quality.length > 0) ? activeComposer.quality : undefined,
        strength: activeComposer && activeComposer.corpusRhythmStrength
      });
    }

    const allowedPool = (RHYTHM_PATTERN_POOLS && Array.isArray(RHYTHM_PATTERN_POOLS[level]))
      ? RHYTHM_PATTERN_POOLS[level]
      : null;
    const allowedSet = allowedPool ? new Set(allowedPool) : null;
    const filteredRhythms=Object.fromEntries(
      Object.entries(rhythmSource).filter(([key, { weights }]) => {
        if (!Array.isArray(weights) || weights[levelIndex] <= 0) {
          return false;
        }
        return allowedSet ? allowedSet.has(key) : true;
      })
    );
    if (!Object.keys(filteredRhythms).length) {
      throw new Error(`getRhythm: no candidate rhythms for level "${level}"`);
    }

    const rhythmKey=randomWeightedSelection(filteredRhythms);
    if (!rhythmKey || !rhythmSource[rhythmKey]) {
      throw new Error(`getRhythm: failed to select valid rhythm pattern for level "${level}"`);
    }

    const { method: rhythmMethodKey, args: rhythmArgs }=rhythmSource[rhythmKey];

    // Record selection for novelty tracking
    V.requireType(LM.activeLayer, 'string', 'LM.activeLayer');
    RhythmHistoryTracker.record(rhythmMethodKey, length, LM.activeLayer);

    // Also feed into AbsoluteTimeWindow for cross-layer rhythm analysis
    const absTime = Number.isFinite(beatStartTime) ? beatStartTime : 0;
    AbsoluteTimeWindow.recordRhythm(rhythmMethodKey, length, LM.activeLayer, absTime);

    const generatedArgs = rhythmArgs(length, pattern);
    // Phase-locked path: only for length-only generators
    if (Array.isArray(generatedArgs) && generatedArgs.length === 1 && generatedArgs[0] === length) {
      return PhaseLockedRhythmGenerator.generate(length, rhythmMethodKey);
    }
    // Fail-fast: delegate to RhythmRegistry, which will throw if method not found
    return RhythmRegistry.execute(rhythmMethodKey, ...generatedArgs);
  }
};
