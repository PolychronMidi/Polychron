// convergenceVelocitySurge.js - brief velocity boost at convergence points.
// When convergenceDetector fires, the next 2-4 notes get a velocity surge,
// creating "impact" moments driven by cross-layer agreement.

convergenceVelocitySurge = (() => {
  const V = validator.create('convergenceVelocitySurge');
  let surgeActive = 0;
  let surgeMultiplier = 1.0;
  let lastSurgeTime = -Infinity;
  const MIN_SURGE_INTERVAL = 1.5;
  // R31 lab: convergence-driven density boost -- locked-in moments get shared intensity
  let densityBoostRemaining = 0;
  const CONVERGENCE_DENSITY_BOOST = 0.15;
  const CONVERGENCE_DENSITY_BEATS = 4;

  function check(absoluteSeconds, layer) {
    postDensityBoost(absoluteSeconds);
    if (surgeActive > 0) {
      surgeActive--;
      return surgeMultiplier;
    }
    if (absoluteSeconds - lastSurgeTime < MIN_SURGE_INTERVAL) return 1.0;
    const conv = convergenceDetector.wasRecent(absoluteSeconds, layer, 200);
    if (conv) {
      surgeActive = ri(2, 4);
      densityBoostRemaining = CONVERGENCE_DENSITY_BEATS;
      // R23: harmonic gravity - surge scales with journey distance
      const stop = safePreBoot.call(() => harmonicJourney.getStop(sectionIndex), null);
      const dist = (stop && Number.isFinite(stop.distance)) ? stop.distance : 0;
      const distScale = 1.0 + clamp(dist * 0.04, 0, 0.15);
      // Melodic coupling: tessituraLoad amplifies surge at extreme registers.
      // High register pressure at a convergence moment -> more expressive impact.
      const melodicCtxCVS = safePreBoot.call(() => emergentMelodicEngine.getContext(), null);
      const tessLoad = melodicCtxCVS ? V.optionalFinite(melodicCtxCVS.tessituraLoad, 0) : 0;
      surgeMultiplier = rf(1.15, 1.35) * distScale * (1.0 + tessLoad * 0.20);
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

  // R31 lab: convergence density boost -- posts to L0 channel for clean inter-module comm
  function postDensityBoost(absoluteSeconds) {
    if (densityBoostRemaining > 0) {
      densityBoostRemaining--;
      const boost = CONVERGENCE_DENSITY_BOOST * (densityBoostRemaining / CONVERGENCE_DENSITY_BEATS);
      if (boost > 0.01) L0.post('convergence-density', 'both', absoluteSeconds, { boost });
    }
  }

  function reset() {
    surgeActive = 0;
    surgeMultiplier = 1.0;
    lastSurgeTime = -Infinity;
    densityBoostRemaining = 0;
  }

  return { check, reset };
})();
crossLayerRegistry.register('convergenceVelocitySurge', convergenceVelocitySurge, ['all', 'section']);
