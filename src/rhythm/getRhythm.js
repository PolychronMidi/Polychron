// src/rhythm/getRhythm.js - Rhythm pattern retrieval with dynamic method selection.

getRhythm = function getRhythm(level,length,pattern,method,...args){
  // Map subsubdiv to subdiv's level index so subsubdiv rhythm selection reuses subdiv candidates
  const levelIndex = (level === 'subsubdiv' ? 2 : ['beat','div','subdiv'].indexOf(level));
  const checkMethod=(m)=>{
    if (!m) { throw new Error('getRhythm.checkMethod: empty method key requested'); }
    if (typeof rhythmMethods !== 'undefined' && rhythmMethods[m] && typeof rhythmMethods[m] === 'function') return rhythmMethods[m];
    throw new Error(`Unknown rhythm method: ${m}`);
  };
  if (method) {
    const rhythmMethod=checkMethod(method);
    return rhythmMethod(...args);
  } else {
    const filteredRhythms=Object.fromEntries(
      Object.entries(rhythms).filter(([_,{ weights }])=>weights[levelIndex] > 0)
    );
    // Diagnostic: if no candidate rhythms exist for the given level, emit debug payload
    try { if (!Object.keys(filteredRhythms).length) console.warn(`No candidate rhythms for level "${level}"`); } catch (_e) { console.warn('getRhythm: diagnostic emit failed:', _e && _e.stack ? _e.stack : _e); }

    const rhythmKey=randomWeightedSelection(filteredRhythms);

    if (rhythmKey && rhythms[rhythmKey]) {
      const { method: rhythmMethodKey,args: rhythmArgs }=rhythms[rhythmKey];
      const rhythmMethod=checkMethod(rhythmMethodKey);
      return rhythmMethod(...rhythmArgs(length,pattern));
    }
  }
  throw new Error('getRhythm: unknown rhythm selection');
};
