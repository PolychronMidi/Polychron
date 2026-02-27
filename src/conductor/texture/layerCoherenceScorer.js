// src/conductor/layerCoherenceScorer.js - Measures harmonic consonance between layers.
// Queries absoluteTimeWindow for concurrent L1/L2 pitch content and scores
// their intervallic compatibility. Pure query API for conductor decisions.

layerCoherenceScorer = (() => {
  let lastCoherence = 0.5;

  // Shared consonant intervals from pitchClassHelpers
  const CONSONANT_INTERVALS = pitchClassHelpers.CONSONANT_INTERVALS;

  /**
   * Recompute consonance between L1 and L2 pitch classes.
   * @param {number} [windowSeconds] - analysis window (default 2s)
   * @returns {number} - 0 (fully dissonant) to 1 (fully consonant)
   */
  function computeCoherence(windowSeconds) {
    const ws = windowSeconds ?? 2;
    const l1Notes = absoluteTimeWindow.getNotes({ layer: 'L1', windowSeconds: ws });
    const l2Notes = absoluteTimeWindow.getNotes({ layer: 'L2', windowSeconds: ws });

    if (l1Notes.length < 2 || l2Notes.length < 2) {
      lastCoherence = 0.5;
      return lastCoherence;
    }

    // Extract unique pitch classes
    const l1Pcs = new Set();
    for (let i = 0; i < l1Notes.length; i++) l1Pcs.add(l1Notes[i].midi % 12);
    const l2Pcs = new Set();
    for (let i = 0; i < l2Notes.length; i++) l2Pcs.add(l2Notes[i].midi % 12);

    let consonantCount = 0;
    let totalPairs = 0;

    for (const pc1 of l1Pcs) {
      for (const pc2 of l2Pcs) {
        const interval = (pc2 - pc1 + 12) % 12;
        if (CONSONANT_INTERVALS.has(interval)) consonantCount++;
        totalPairs++;
      }
    }

    lastCoherence = totalPairs > 0 ? consonantCount / totalPairs : 0.5;
    return lastCoherence;
  }

  /**
   * Get the most recently computed coherence score.
   * @returns {number} - 0 to 1
   */
  function getCoherence() {
    return lastCoherence;
  }

  /**
   * Check if the layers are in harmonic tension (low coherence).
   * @param {number} [threshold] - coherence below this = tension (default 0.35)
   * @returns {boolean}
   */
  function isInTension(threshold) {
    return lastCoherence < (threshold ?? 0.35);
  }

  /**
   * Get a bias factor for density control based on coherence.
   * High coherence - allow more density; low - thin out to reduce clashing.
   * @returns {number} - 0.6 to 1.2
   */
  function getDensityBias() {
    // Map coherence 0-0.70, 0.5-1.0, 1.0-1.15 (recentered: was 0.6+c*0.6, chronic 0.90)
    return clamp(0.70 + lastCoherence * 0.45, 0.70, 1.15);
  }

  /** Reset to neutral. */
  function reset() {
    lastCoherence = 0.5;
  }

  conductorIntelligence.registerRecorder('layerCoherenceScorer', () => { layerCoherenceScorer.computeCoherence(); });
  conductorIntelligence.registerDensityBias('layerCoherenceScorer', () => layerCoherenceScorer.getDensityBias(), 0.90, 1.15);
  conductorIntelligence.registerModule('layerCoherenceScorer', { reset }, ['section']);

  return {
    computeCoherence,
    getCoherence,
    isInTension,
    getDensityBias,
    reset
  };
})();
