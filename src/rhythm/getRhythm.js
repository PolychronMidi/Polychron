// src/rhythm/getRhythm.js - Rhythm pattern retrieval with dynamic method selection.

getRhythm = function getRhythm(level,length,pattern,method,...args){
  // Map subsubdiv to subdiv's level index so subsubdiv rhythm selection reuses subdiv candidates
  const levelIndex = (level === 'subsubdiv' ? 2 : ['beat','div','subdiv'].indexOf(level));

  if (method) {
    if (!method) throw new Error('getRhythm: empty method key requested');
    // Phase-locked path: length-only patterns can be generated with phase cohesion
    if (typeof PhaseLockedRhythmGenerator !== 'undefined' && args && args.length === 1 && args[0] === length) {
      return PhaseLockedRhythmGenerator.generate(length, method);
    }
    // Fail-fast: delegate to RhythmRegistry, which will throw if method not found
    return RhythmRegistry.execute(method, ...args);
  } else {
    const fxBiasedRhythmSource = (typeof FXFeedbackListener !== 'undefined' && FXFeedbackListener && typeof FXFeedbackListener.biasRhythmWeights === 'function')
      ? FXFeedbackListener.biasRhythmWeights(rhythms)
      : rhythms;

    // Chain journey-boldness bias on top of FX bias
    let rhythmSource = (typeof JourneyRhythmCoupler !== 'undefined' && JourneyRhythmCoupler && typeof JourneyRhythmCoupler.biasRhythmWeights === 'function')
      ? JourneyRhythmCoupler.biasRhythmWeights(fxBiasedRhythmSource)
      : fxBiasedRhythmSource;
    const hasLayerContext = typeof LM !== 'undefined' && LM && typeof LM.getComposerFor === 'function' && typeof LM.activeLayer === 'string' && LM.activeLayer.length > 0;
    const activeComposer = hasLayerContext ? LM.getComposerFor(LM.activeLayer) : null;
    const useCorpusRhythmPriors = Boolean(activeComposer && activeComposer.useCorpusRhythmPriors === true);

    if (useCorpusRhythmPriors) {
      if (typeof rhythmPriors === 'undefined' || !rhythmPriors || typeof rhythmPriors.getBiasedRhythms !== 'function') {
        throw new Error('getRhythm: rhythmPriors.getBiasedRhythms() unavailable while corpus rhythm priors are enabled');
      }

      const phraseContext = (typeof ComposerFactory !== 'undefined' && ComposerFactory && ComposerFactory.sharedPhraseArcManager && typeof ComposerFactory.sharedPhraseArcManager.getPhraseContext === 'function')
        ? ComposerFactory.sharedPhraseArcManager.getPhraseContext()
        : undefined;

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

    const filteredRhythms=Object.fromEntries(
      Object.entries(rhythmSource).filter(([, { weights }]) => weights[levelIndex] > 0)
    );
    if (!Object.keys(filteredRhythms).length) {
      throw new Error(`getRhythm: no candidate rhythms for level "${level}"`);
    }

    const rhythmKey=randomWeightedSelection(filteredRhythms);
    if (!rhythmKey || !rhythmSource[rhythmKey]) {
      throw new Error(`getRhythm: failed to select valid rhythm pattern for level "${level}"`);
    }

    const { method: rhythmMethodKey, args: rhythmArgs }=rhythmSource[rhythmKey];
    const generatedArgs = rhythmArgs(length, pattern);
    // Phase-locked path: only for length-only generators
    if (typeof PhaseLockedRhythmGenerator !== 'undefined' && Array.isArray(generatedArgs) && generatedArgs.length === 1 && generatedArgs[0] === length) {
      return PhaseLockedRhythmGenerator.generate(length, rhythmMethodKey);
    }
    // Fail-fast: delegate to RhythmRegistry, which will throw if method not found
    return RhythmRegistry.execute(rhythmMethodKey, ...generatedArgs);
  }
};
