// convergenceVelocitySurge.js - brief velocity boost at convergence points.
// When convergenceDetector fires, the next 2-4 notes get a velocity surge,
// creating "impact" moments driven by cross-layer agreement.

moduleLifecycle.declare({
  name: 'convergenceVelocitySurge',
  subsystem: 'crossLayer',
  deps: ['L0', 'harmonicJourney', 'validator'],
  lazyDeps: ['convergenceDetector', 'emergentDownbeat', 'emergentMelodicEngine'],
  provides: ['convergenceVelocitySurge'],
  crossLayerScopes: ['all', 'section'],
  init: (deps) => {
  const L0 = deps.L0;
  const harmonicJourney = deps.harmonicJourney;
  const V = deps.validator.create('convergenceVelocitySurge');
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
      const stop = harmonicJourney.getStop(sectionIndex);
      const dist = (stop && Number.isFinite(stop.distance)) ? stop.distance : 0;
      const distScale = 1.0 + clamp(dist * 0.04, 0, 0.15);
      // Melodic coupling: tessituraLoad amplifies surge at extreme registers.
      // High register pressure at a convergence moment -> more expressive impact.
      const melodicCtxCVS = emergentMelodicEngine.getContext();
      const tessLoad = melodicCtxCVS ? V.optionalFinite(melodicCtxCVS.tessituraLoad, 0) : 0;
      // contourShape: rising arc at convergence = more expressive impact (build cresting);
      // falling arc = softer impact (release phase doesn't need the punch).
      const contourSurgeMod = melodicCtxCVS
        ? (melodicCtxCVS.contourShape === 'rising' ? 1.08 : melodicCtxCVS.contourShape === 'falling' ? 0.93 : 1.0)
        : 1.0;
      // Rhythmic coupling: density surprise amplifies convergence impact.
      // Convergence during a dense rhythmic moment = more expressive punch.
      const rhythmEntryVS = L0.getLast(L0_CHANNELS.emergentRhythm, { layer: 'both' });
      const densitySurpriseVS = rhythmEntryVS && Number.isFinite(rhythmEntryVS.densitySurprise) ? rhythmEntryVS.densitySurprise : 1.0;
      const rhythmSurgeMod = densitySurpriseVS > 1.1 ? 1.10 : densitySurpriseVS < 0.9 ? 0.95 : 1.0;
      surgeMultiplier = rf(1.15, 1.35) * distScale * (1.0 + tessLoad * 0.20) * contourSurgeMod * rhythmSurgeMod;
      lastSurgeTime = absoluteSeconds;
      // R23: convergence cascade - surge triggers emergent downbeat tempo mult
      if (surgeMultiplier > 1.2) {
        emergentDownbeat.applyTempoMultiplier(
          layer, 60, clamp(m.round(80 * surgeMultiplier), 40, 120), surgeMultiplier - 1.0
        );
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
      if (boost > 0.01) L0.post(L0_CHANNELS.convergenceDensity, 'both', absoluteSeconds, { boost });
    }
  }

  function reset() {
    surgeActive = 0;
    surgeMultiplier = 1.0;
    lastSurgeTime = -Infinity;
    densityBoostRemaining = 0;
  }

  return { check, reset };
  },
});
