// src/rhythm/getRhythm.js - Rhythm pattern retrieval with dynamic method selection.

let getRhythmGetRhythmDepsValidated = false;

function assertGetRhythmDeps() {
  if (getRhythmGetRhythmDepsValidated) return;
  if (!FXFeedbackListener || !FXFeedbackListener.biasRhythmWeights) {
    throw new Error('getRhythm: FXFeedbackListener.biasRhythmWeights is required');
  }
  if (!stutterFeedbackListener || !stutterFeedbackListener.biasRhythmWeights) {
    throw new Error('getRhythm: stutterFeedbackListener.biasRhythmWeights is required');
  }
  if (!journeyRhythmCoupler || !journeyRhythmCoupler.biasRhythmWeights) {
    throw new Error('getRhythm: journeyRhythmCoupler.biasRhythmWeights is required');
  }
  if (!emergentRhythmEngine || !emergentRhythmEngine.biasRhythmWeights) {
    throw new Error('getRhythm: emergentRhythmEngine.biasRhythmWeights is required');
  }
  if (!phaseLockedRhythmGenerator || !phaseLockedRhythmGenerator.generate) {
    throw new Error('getRhythm: phaseLockedRhythmGenerator.generate is required');
  }
  getRhythmGetRhythmDepsValidated = true;
}

const V = validator.create('getRhythm');

getRhythm = function getRhythm(level,length,pattern,method,...args){
  assertGetRhythmDeps();
  V.assertNonEmptyString(level, 'level');
  V.requireFinite(length, 'length');
  // Map subsubdiv to subdiv's level index so subsubdiv rhythm selection reuses subdiv candidates
  const levelIndex = (level === 'subsubdiv' ? 2 : ['beat','div','subdiv'].indexOf(level));

  if (method) {
    // Phase-locked path: length-only patterns can be generated with phase cohesion
    if (args && args.length === 1 && args[0] === length) {
      return phaseLockedRhythmGenerator.generate(length, method);
    }
    // Fail-fast: delegate to rhythmRegistry, which will throw if method not found
    return rhythmRegistry.execute(method, ...args);
  } else {
    const fxBiasedRhythmSource = FXFeedbackListener.biasRhythmWeights(rhythms);

    // Also apply stutter-based rhythm bias if available
    const stutterBiasedRhythmSource = stutterFeedbackListener.biasRhythmWeights(fxBiasedRhythmSource);

    // Chain journey-boldness bias on top of FX+stutter bias
    let rhythmSource = journeyRhythmCoupler.biasRhythmWeights(stutterBiasedRhythmSource);

    // Chain emergent cross-layer pattern bias (4th link): contagion+downbeat+feedback -> rhythm shape
    rhythmSource = emergentRhythmEngine.biasRhythmWeights(rhythmSource);

    // Apply rhythm history novelty penalty to discourage repetition
    rhythmSource = rhythmHistoryTracker.penalizeRepetition(rhythmSource);

    // R69 E4: Regime-responsive rhythm novelty. During evolving, apply
    // an extra novelty boost (double the penalty) to push rhythmic variety.
    // During coherent, reduce the penalty (more repetition is OK for stability).
    // R79 E2: Add exploring-specific variety boost. Exploring regime now also
    // gets a novelty penalty pass, creating rhythmic diversity during exploratory
    // passages. This untouched subsystem (since R69) now differentiates all 3
    // active regimes rhythmically: evolving=double penalty, exploring=single
    // extra penalty, coherent=baseline repetition allowed.
    const profSnap = systemDynamicsProfiler.getSnapshot();
    if (profSnap && (profSnap.regime === 'evolving' || profSnap.regime === 'exploring')) {
      rhythmSource = rhythmHistoryTracker.penalizeRepetition(rhythmSource);
    }

    V.assertNonEmptyString(LM.activeLayer, 'LM.activeLayer');
    const activeLayerName = /** @type {string} */ (LM.activeLayer);
    const activeComposer = LM.getComposerFor(activeLayerName);
    const useCorpusRhythmPriors = Boolean(activeComposer && activeComposer.useCorpusRhythmPriors === true);

    if (useCorpusRhythmPriors) {
      const phraseContext = FactoryManager.sharedPhraseArcManager.getPhraseContext();

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
        if (!Array.isArray(weights) || weights[levelIndex] <= 0) { // eslint-disable-line local/prefer-validator
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
    rhythmHistoryTracker.record(rhythmMethodKey, length, activeLayerName);

    // Also feed into L0 for cross-layer rhythm analysis
    const absTime = beatStartTime;
    L0.post(L0_CHANNELS.rhythm, activeLayerName, absTime, { method: rhythmMethodKey, length });

    const generatedArgs = rhythmArgs(length, pattern);
    // Phase-locked path: only for length-only generators
    if (Array.isArray(generatedArgs) && generatedArgs.length === 1 && generatedArgs[0] === length) {
      return phaseLockedRhythmGenerator.generate(length, rhythmMethodKey);
    }
    // Fail-fast: delegate to rhythmRegistry, which will throw if method not found
    return rhythmRegistry.execute(rhythmMethodKey, ...generatedArgs);
  }
};
