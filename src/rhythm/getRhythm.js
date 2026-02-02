// src/rhythm/getRhythm.js - extracted from src/rhythm.js

// Ensure rhythmMethods registry exists (populated by `rhythm/index.js` on require)
rhythmMethods = (typeof rhythmMethods !== 'undefined' && rhythmMethods) ? rhythmMethods : {};

getRhythm = function getRhythm(level,length,pattern,method,...args){
  // Map subsubdiv to subdiv's level index so subsubdiv rhythm selection reuses subdiv candidates
  const levelIndex = (level === 'subsubdiv' ? 2 : ['beat','div','subdiv'].indexOf(level));
  const checkMethod=(m)=>{
    if (!m) return null;
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
    try { if (!Object.keys(filteredRhythms).length) console.warn(`No candidate rhythms for level "${level}"`); } catch (_e) { /* swallow */ }

    const rhythmKey=randomWeightedSelection(filteredRhythms);

    if (rhythmKey && rhythms[rhythmKey]) {
      const { method: rhythmMethodKey,args: rhythmArgs }=rhythms[rhythmKey];
      const rhythmMethod=checkMethod(rhythmMethodKey);
      if (!rhythmMethod) {
        try { console.warn(`Missing rhythm method for level "${level}": ${rhythmMethodKey}`); } catch (_e) { /* swallow */ }
      }
      if (rhythmMethod) return rhythmMethod(...rhythmArgs(length,pattern));
    }
  }
  console.warn('unknown rhythm');
  return null;
};
