// src/conductor/CrossLayerRhythmPhaseTracker.js - Phase relationship between L1 and L2 onsets.
// Detects in-phase, counter-phase, or complementary rhythmic alignment.
// Pure query API — advises PhaseLockedRhythmGenerator to sync, offset, or diverge.

CrossLayerRhythmPhaseTracker = (() => {
  const WINDOW_SECONDS = 2;
  const COINCIDENCE_THRESHOLD = 0.05; // seconds: two onsets within this = coincident

  /**
   * Compute the phase relationship between L1 and L2 onset patterns.
   * @param {number} [windowSeconds]
   * @returns {{ phase: string, coincidence: number, complementarity: number }}
   */
  function getPhaseRelationship(windowSeconds) {
    const ws = (typeof windowSeconds === 'number' && Number.isFinite(windowSeconds)) ? windowSeconds : WINDOW_SECONDS;
    const l1Notes = AbsoluteTimeWindow.getNotes({ layer: 'L1', windowSeconds: ws });
    const l2Notes = AbsoluteTimeWindow.getNotes({ layer: 'L2', windowSeconds: ws });

    if (l1Notes.length < 2 || l2Notes.length < 2) {
      return { phase: 'unknown', coincidence: 0, complementarity: 0 };
    }

    // Count coincident onsets (matching within threshold)
    let coincidentCount = 0;
    let l2Idx = 0;
    for (let i = 0; i < l1Notes.length; i++) {
      const t1 = l1Notes[i].time;
      while (l2Idx < l2Notes.length && l2Notes[l2Idx].time < t1 - COINCIDENCE_THRESHOLD) {
        l2Idx++;
      }
      if (l2Idx < l2Notes.length && m.abs(l2Notes[l2Idx].time - t1) <= COINCIDENCE_THRESHOLD) {
        coincidentCount++;
      }
    }

    const minCount = m.min(l1Notes.length, l2Notes.length);
    const coincidence = minCount > 0 ? coincidentCount / minCount : 0;
    const complementarity = clamp(1 - coincidence, 0, 1);

    let phase = 'mixed';
    if (coincidence > 0.7) phase = 'in-phase';
    else if (coincidence < 0.2) phase = 'counter-phase';
    else if (complementarity > 0.6) phase = 'complementary';

    return { phase, coincidence, complementarity };
  }

  /**
   * Suggest a rhythm phase strategy for the given layer.
   * @param {string} layer - current layer
   * @returns {{ strategy: string, offsetBias: number }}
   */
  function suggestPhaseStrategy(layer) {
    const rel = getPhaseRelationship();

    // If layers are too locked together, suggest offsetting
    if (rel.phase === 'in-phase') {
      return { strategy: 'offset', offsetBias: 0.5 };
    }
    // If layers are already nicely offset, maintain
    if (rel.phase === 'complementary') {
      return { strategy: 'maintain', offsetBias: 0 };
    }
    // Counter-phase: let them converge slightly for cohesion
    if (rel.phase === 'counter-phase') {
      return { strategy: 'converge', offsetBias: -0.3 };
    }
    // Mixed: small nudge toward complement based on layer
    return { strategy: 'complement', offsetBias: layer === 'L2' ? 0.2 : 0 };
  }

  return {
    getPhaseRelationship,
    suggestPhaseStrategy
  };
})();
