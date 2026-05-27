// motifValues.js - small pure helpers for motif transformations

motifValues = (function() {
  function repeatPattern(pattern, times) {
    if (!Array.isArray(pattern)) throw new Error('motifValues.repeatPattern: pattern array required');
    if (typeof times !== 'number' || times < 1) throw new Error('motifValues.repeatPattern: times must be >= 1');
    let out = [];
    for (let i = 0; i < times; i++) out = out.concat(pattern);
    return out;
  }

  function offsetPattern(pattern, offsetSteps) {
    if (!Array.isArray(pattern)) throw new Error('motifValues.offsetPattern: pattern array required');
    if (typeof offsetSteps !== 'number') throw new Error('motifValues.offsetPattern: offsetSteps must be numeric');
    return pattern.map(v => ({ ...v, time: v.time + offsetSteps }));
  }

  function scaleDurations(pattern, scale) {
    if (!Array.isArray(pattern)) throw new Error('motifValues.scaleDurations: pattern array required');
    if (typeof scale !== 'number') throw new Error('motifValues.scaleDurations: scale must be numeric');
    return pattern.map(n => ({ ...n, duration: (typeof n.duration === 'number' ? n.duration : 1) * scale }));
  }

  return { repeatPattern, offsetPattern, scaleDurations };
})();
