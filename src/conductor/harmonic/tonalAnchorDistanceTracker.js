// src/conductor/tonalAnchorDistanceTracker.js - Tonal distance from home key tracker.
// Measures distance in semitones from a running "home key" center,
// signalling harmonic adventure level. Tension bias proportional to distance.
// Pure query API - no side effects.

moduleLifecycle.declare({
  name: 'tonalAnchorDistanceTracker',
  subsystem: 'conductor',
  deps: [],
  provides: ['tonalAnchorDistanceTracker'],
  init: (deps) => {
  const WINDOW_SECONDS = 10;
  let homeCenter = -1; // established from first substantial material

  /**
   * Compute tonal distance from home center.
   * @returns {{ distance: number, tensionBias: number, adventureLevel: string }}
   */
  function tonalAnchorDistanceTrackerComputeDistanceSignal() {
    const { counts: pcCounts, total } = pitchClassHelpers.getPitchClassHistogram(WINDOW_SECONDS);

    if (total < 5) {
      return { distance: 0, tensionBias: 1, adventureLevel: 'home' };
    }

    let maxCount = 0;
    let currentCenter = 0;
    for (let i = 0; i < 12; i++) {
      if (pcCounts[i] > maxCount) {
        maxCount = pcCounts[i];
        currentCenter = i;
      }
    }

    // Establish home center from first significant analysis
    if (homeCenter < 0) {
      homeCenter = currentCenter;
    }

    // Compute pitch-class distance (circle of fifths distance for musical relevance)
    // Simple semitone distance mod 12, taking the shorter path
    const rawDist = m.abs(currentCenter - homeCenter);
    const distance = m.min(rawDist, 12 - rawDist);

    // Adventure level based on distance
    let adventureLevel = 'home';
    if (distance === 0) adventureLevel = 'home';
    else if (distance <= 2) adventureLevel = 'near';
    else if (distance <= 4) adventureLevel = 'moderate';
    else adventureLevel = 'far';

    // Tension bias: continuous ramp from distance 0-6.
    // distance 0 - 0.97 (grounded), 1-6 - ramp 0.97-1.1
    let tensionBias = 0.97 + clamp(distance / 6, 0, 1) * 0.13;
    if (tensionBias > 1.0) {
      const tensionProduct = conductorState.getField('tension');
      const saturationPressure = clamp((tensionProduct - 1.08) / 0.20, 0, 1);
      if (saturationPressure > 0) {
        tensionBias = 1.0 + (tensionBias - 1.0) * (1 - saturationPressure * 0.60);
      }
    }

    return { distance, tensionBias, adventureLevel };
  }

  const tonalAnchorDistanceTrackerCache = beatCache.create(tonalAnchorDistanceTrackerComputeDistanceSignal);

  /**
   * Compute tonal distance from home center (cached per beat).
   * @returns {{ distance: number, tensionBias: number, adventureLevel: string }}
   */
  function getDistanceSignal() { return tonalAnchorDistanceTrackerCache.get(); }

  /**
   * Get tension multiplier for the derivedTension chain.
   * @returns {number}
   */
  function getTensionBias() {
    return getDistanceSignal().tensionBias;
  }

  /** Reset tracking (including home center). */
  function reset() {
    homeCenter = -1;
  }

  conductorIntelligence.registerTensionBias('tonalAnchorDistanceTracker', () => tonalAnchorDistanceTracker.getTensionBias(), 0.9, 1.12);
  conductorIntelligence.registerStateProvider('tonalAnchorDistanceTracker', () => {
    const s = tonalAnchorDistanceTracker.getDistanceSignal();
    return { tonalAdventureLevel: s ? s.adventureLevel : 'home' };
  });
  conductorIntelligence.registerModule('tonalAnchorDistanceTracker', { reset }, ['section']);

  return {
    getDistanceSignal,
    getTensionBias,
    reset
  };
  },
});
