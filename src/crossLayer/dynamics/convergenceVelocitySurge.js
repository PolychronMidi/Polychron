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
      // R23: harmonic gravity - surge scales with journey distance
      const stop = safePreBoot.call(() => harmonicJourney.getStop(sectionIndex), null);
      const dist = (stop && Number.isFinite(stop.distance)) ? stop.distance : 0;
      const distScale = 1.0 + clamp(dist * 0.04, 0, 0.15);
      surgeMultiplier = rf(1.15, 1.35) * distScale;
      lastSurgeTime = absoluteSeconds;
      // R23: convergence cascade - surge triggers emergent downbeat tempo mult
      if (surgeMultiplier > 1.2) {
        safePreBoot.call(() => emergentDownbeat.applyTempoMultiplier(
          layer, 60, clamp(m.round(80 * surgeMultiplier), 40, 120), surgeMultiplier - 1.0
        ), null);
      }
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
