// RhythmValues.js - pure helper functions for rhythm value transformations

RhythmValues = (function() {
  function quantizeTime(time, resolution) {
    if (typeof time !== 'number' || typeof resolution !== 'number') throw new Error('RhythmValues.quantizeTime: numeric args required');
    return m.round(time * resolution) / resolution;
  }

  function swingOffset(beatIndex, amount) {
    if (typeof amount !== 'number') throw new Error('RhythmValues.swingOffset: numeric args required');
    // amount 0..1, returns a signed offset in fractions of a beat
    return ((beatIndex % 2) === 1) ? amount * 0.5 : -amount * 0.5;
  }

  function accentWeight(beatIndex, pattern) {
    if (!Array.isArray(pattern)) throw new Error('RhythmValues.accentWeight: bad args');
    return pattern[beatIndex % pattern.length] ? 1 : 0;
  }

  return {
    quantizeTime,
    swingOffset,
    accentWeight
  };
})();
