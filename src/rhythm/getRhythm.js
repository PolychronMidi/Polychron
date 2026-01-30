// src/rhythm/getRhythm.js - extracted from src/rhythm.js
const { writeDebugFile } = require('../debug/logGate');

module.exports.getRhythm = function getRhythm(level,length,pattern,method,...args){
  // Map subsubdiv to subdiv's level index so subsubdiv rhythm selection reuses subdiv candidates
  const levelIndex = (level === 'subsubdiv' ? 2 : ['beat','div','subdiv'].indexOf(level));
  const checkMethod=(m)=>{
    if (!m) return null;
    if (typeof __POLYCHRON_TEST__ !== 'undefined' && __POLYCHRON_TEST__[m] && typeof __POLYCHRON_TEST__[m] === 'function') return __POLYCHRON_TEST__[m];
    try {
      const f = (new Function('return typeof ' + m + ' === "function" ? ' + m + ' : null'))();
      if (typeof f === 'function') return f;
    } catch (_e) { /* swallow */ }
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
    try { if (!Object.keys(filteredRhythms).length) writeDebugFile('rhythm-debug.ndjson', { tag: 'no-candidates', level, levelIndex, length, pattern, rhythms: Object.keys(rhythms) }); } catch (_e) { /* swallow */ }

    const rhythmKey=randomWeightedSelection(filteredRhythms);
    try { writeDebugFile('rhythm-debug.ndjson', { tag: 'candidate-selected', level, rhythmKey, candidates: Object.keys(filteredRhythms) }); } catch (_e) { /* swallow */ }

    if (rhythmKey && rhythms[rhythmKey]) {
      const { method: rhythmMethodKey,args: rhythmArgs }=rhythms[rhythmKey];
      const rhythmMethod=checkMethod(rhythmMethodKey);
      if (!rhythmMethod) {
        try { writeDebugFile('rhythm-debug.ndjson', { tag: 'missing-method', level, rhythmKey, rhythmMethodKey }); } catch (_e) { /* swallow */ }
      }
      if (rhythmMethod) return rhythmMethod(...rhythmArgs(length,pattern));
    }
  }
  console.warn('unknown rhythm');
  try { writeDebugFile('rhythm-debug.ndjson', { tag: 'unknown-rhythm', level, levelIndex, length, pattern, candidates: Object.keys(rhythms).filter(k => rhythms[k].weights[levelIndex] > 0) }); } catch (_e) { /* swallow */ }
  return null;
};
