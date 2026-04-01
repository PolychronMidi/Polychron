// convergenceVelocitySurge.js - brief velocity boost at convergence points.
// When convergenceDetector fires, the next 2-4 notes get a velocity surge,
// creating "impact" moments driven by cross-layer agreement.

convergenceVelocitySurge = (() => {
  let surgeActive = 0;
  let surgeMultiplier = 1.0;
  let lastSurgeTime = -Infinity;
  const MIN_SURGE_INTERVAL = 1.5;

  function check(absoluteSeconds, layer) {
    if (surgeActive > 0) {
      surgeActive--;
      return surgeMultiplier;
    }
    if (absoluteSeconds - lastSurgeTime < MIN_SURGE_INTERVAL) return 1.0;
    const conv = convergenceDetector.wasRecent(absoluteSeconds, layer, 200);
    if (conv) {
      surgeActive = ri(2, 4);
      surgeMultiplier = rf(1.15, 1.35);
      lastSurgeTime = absoluteSeconds;
      return surgeMultiplier;
    }
    return 1.0;
  }

  function reset() {
    surgeActive = 0;
    surgeMultiplier = 1.0;
    lastSurgeTime = -Infinity;
  }

  return { check, reset };
})();
crossLayerRegistry.register('convergenceVelocitySurge', convergenceVelocitySurge, ['all', 'section']);
