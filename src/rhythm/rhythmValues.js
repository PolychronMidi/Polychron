// rhythmValues.js - pure helper functions for rhythm value transformations

rhythmValues = (function() {
  const V = validator.create('rhythmValues');
  function quantizeTime(time, resolution) {
    V.requireFinite(time, 'quantizeTime.time');
    V.requireFinite(resolution, 'quantizeTime.resolution');
    return m.round(time * resolution) / resolution;
  }

  function swingOffset(beatIndex, amount) {
    V.requireFinite(amount, 'swingOffset.amount');
    // amount 0..1, returns a signed offset in fractions of a beat
    return ((beatIndex % 2) === 1) ? amount * 0.5 : -amount * 0.5;
  }

  function accentWeight(beatIndex, pattern) {
    V.assertArray(pattern, 'accentWeight.pattern');
    return pattern[beatIndex % pattern.length] ? 1 : 0;
  }

  return {
    quantizeTime,
    swingOffset,
    accentWeight
  };
})();
