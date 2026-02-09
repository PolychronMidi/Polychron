// src/rhythm/getRhythm.js - Rhythm pattern retrieval with dynamic method selection.

getRhythm = function getRhythm(level,length,pattern,method,...args){
  // Map subsubdiv to subdiv's level index so subsubdiv rhythm selection reuses subdiv candidates
  const levelIndex = (level === 'subsubdiv' ? 2 : ['beat','div','subdiv'].indexOf(level));

  if (method) {
    if (!method) throw new Error('getRhythm: empty method key requested');
    // Fail-fast: delegate to RhythmRegistry, which will throw if method not found
    return RhythmRegistry.execute(method, ...args);
  } else {
    const filteredRhythms=Object.fromEntries(
      Object.entries(rhythms).filter(([_,{ weights }])=>weights[levelIndex] > 0)
    );
    if (!Object.keys(filteredRhythms).length) {
      throw new Error(`getRhythm: no candidate rhythms for level "${level}"`);
    }

    const rhythmKey=randomWeightedSelection(filteredRhythms);
    if (!rhythmKey || !rhythms[rhythmKey]) {
      throw new Error(`getRhythm: failed to select valid rhythm pattern for level "${level}"`);
    }

    const { method: rhythmMethodKey, args: rhythmArgs }=rhythms[rhythmKey];
    // Fail-fast: delegate to RhythmRegistry, which will throw if method not found
    return RhythmRegistry.execute(rhythmMethodKey, ...rhythmArgs(length,pattern));
  }
};
