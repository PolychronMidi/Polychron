// src/rhythm/getRhythm.js - Rhythm pattern retrieval with dynamic method selection.

getRhythm = function getRhythm(level,length,pattern,method,...args){
  // Map subsubdiv to subdiv's level index so subsubdiv rhythm selection reuses subdiv candidates
  const levelIndex = (level === 'subsubdiv' ? 2 : ['beat','div','subdiv'].indexOf(level));
  const checkMethod=(m)=>{
    if (!m) { console.warn('getRhythm.checkMethod: empty method key requested'); return null; }
    if (typeof rhythmMethods !== 'undefined' && rhythmMethods[m] && typeof rhythmMethods[m] === 'function') return rhythmMethods[m];
    console.warn(`Unknown rhythm method: ${m}`);
    return null;
  };
  if (method) {
    const rhythmMethod=checkMethod(method);
    if (rhythmMethod) return rhythmMethod(...args);
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
      if (!rhythmMethod) {
        try { console.warn(`Missing rhythm method for level "${level}": ${rhythmMethodKey}`); } catch (_e) { console.warn('getRhythm: missing rhythm method diagnostic failed:', _e && _e.stack ? _e.stack : _e); }
      }
      if (rhythmMethod) return rhythmMethod(...rhythmArgs(length,pattern));
    }
  }
  console.warn('unknown rhythm');
  return null;
};
