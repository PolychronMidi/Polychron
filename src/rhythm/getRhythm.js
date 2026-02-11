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
    const rhythmSource = (typeof FXFeedbackListener !== 'undefined' && FXFeedbackListener && typeof FXFeedbackListener.biasRhythmWeights === 'function')
      ? FXFeedbackListener.biasRhythmWeights(rhythms)
      : rhythms;
    const filteredRhythms=Object.fromEntries(
      Object.entries(rhythmSource).filter(([_,{ weights }])=>weights[levelIndex] > 0)
    );
    if (!Object.keys(filteredRhythms).length) {
      throw new Error(`getRhythm: no candidate rhythms for level "${level}"`);
    }

    const rhythmKey=randomWeightedSelection(filteredRhythms);
    if (!rhythmKey || !rhythms[rhythmKey]) {
      throw new Error(`getRhythm: failed to select valid rhythm pattern for level "${level}"`);
    }

    const { method: rhythmMethodKey, args: rhythmArgs }=rhythms[rhythmKey];
    const generatedArgs = rhythmArgs(length, pattern);
    // Phase-locked path: only for length-only generators
    if (typeof PhaseLockedRhythmGenerator !== 'undefined' && Array.isArray(generatedArgs) && generatedArgs.length === 1 && generatedArgs[0] === length) {
      return PhaseLockedRhythmGenerator.generate(length, rhythmMethodKey);
    }
    // Fail-fast: delegate to RhythmRegistry, which will throw if method not found
    return RhythmRegistry.execute(rhythmMethodKey, ...generatedArgs);
  }
};
