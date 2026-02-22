// src/conductor/TonalAnchorDistanceTracker.js - Tonal distance from home key tracker.
// Measures distance in semitones from a running "home key" center,
// signalling harmonic adventure level. Tension bias proportional to distance.
// Pure query API — no side effects.

TonalAnchorDistanceTracker = (() => {
  const WINDOW_SECONDS = 10;
  let homeCenter = -1; // established from first substantial material

  /**
   * Compute tonal distance from home center.
   * @returns {{ distance: number, tensionBias: number, adventureLevel: string }}
   */
  function _computeDistanceSignal() {
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

    // Tension bias: farther from home → more tension (unstable), but capped
    let tensionBias = 1;
    if (distance >= 5) {
      tensionBias = 1.1; // far from home → noticeable tension
    } else if (distance >= 3) {
      tensionBias = 1.05; // moderately distant
    } else if (distance === 0) {
      tensionBias = 0.97; // very grounded → allow slight relaxation
    }

    return { distance, tensionBias, adventureLevel };
  }

  const _cache = beatCache.create(_computeDistanceSignal);

  /**
   * Compute tonal distance from home center (cached per beat).
   * @returns {{ distance: number, tensionBias: number, adventureLevel: string }}
   */
  function getDistanceSignal() { return _cache.get(); }

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

  ConductorIntelligence.registerTensionBias('TonalAnchorDistanceTracker', () => TonalAnchorDistanceTracker.getTensionBias(), 0.9, 1.12);
  ConductorIntelligence.registerStateProvider('TonalAnchorDistanceTracker', () => {
    const s = TonalAnchorDistanceTracker.getDistanceSignal();
    return { tonalAdventureLevel: s ? s.adventureLevel : 'home' };
  });
  ConductorIntelligence.registerModule('TonalAnchorDistanceTracker', { reset }, ['section']);

  return {
    getDistanceSignal,
    getTensionBias,
    reset
  };
})();
