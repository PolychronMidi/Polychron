// src/conductor/HarmonicSurpriseIndex.js - Chord-progression predictability analysis.
// Measures pitch-class transition entropy in the ATW window.
// High entropy = surprising/fresh; low entropy = predictable/stale.
// Pure query API — biases derivedTension toward harmonic freshness.

HarmonicSurpriseIndex = (() => {
  const WINDOW_SECONDS = 6;

  /**
   * Compute pitch-class transition entropy from recent notes.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ entropy: number, surpriseIndex: number, stale: boolean, fresh: boolean }}
   */
  function getSurpriseProfile(opts) {
    const { layer, windowSeconds } = opts || {};
    const ws = (typeof windowSeconds === 'number' && Number.isFinite(windowSeconds)) ? windowSeconds : WINDOW_SECONDS;
    const notes = AbsoluteTimeWindow.getNotes({ layer, windowSeconds: ws });
    if (notes.length < 4) {
      return { entropy: 0, surpriseIndex: 0.5, stale: false, fresh: false };
    }

    // Build pitch-class bigram transition counts
    const transitionCounts = /** @type {Object.<string, number>} */ ({});
    let totalTransitions = 0;

    for (let i = 1; i < notes.length; i++) {
      const prevPC = (typeof notes[i - 1].midi === 'number') ? ((notes[i - 1].midi % 12) + 12) % 12 : 0;
      const currPC = (typeof notes[i].midi === 'number') ? ((notes[i].midi % 12) + 12) % 12 : 0;
      const key = prevPC + '->' + currPC;
      transitionCounts[key] = (transitionCounts[key] || 0) + 1;
      totalTransitions++;
    }

    if (totalTransitions === 0) {
      return { entropy: 0, surpriseIndex: 0.5, stale: false, fresh: false };
    }

    // Shannon entropy of transition distribution
    let entropy = 0;
    const keys = Object.keys(transitionCounts);
    for (let i = 0; i < keys.length; i++) {
      const count = transitionCounts[keys[i]];
      if (typeof count === 'number' && count > 0) {
        const p = count / totalTransitions;
        entropy -= p * m.log2(p);
      }
    }

    // Normalize: max possible entropy for 144 bigrams (12x12) ≈ 7.17
    // But realistic max is much lower; normalize to ~4.5 for practical range
    const surpriseIndex = clamp(entropy / 4.5, 0, 1);

    return {
      entropy,
      surpriseIndex,
      stale: surpriseIndex < 0.25,
      fresh: surpriseIndex > 0.65
    };
  }

  /**
   * Get a tension bias based on harmonic freshness.
   * Stale progressions → boost tension to encourage change; fresh → no adjustment.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {number} - 0.9 to 1.25
   */
  function getTensionBias(opts) {
    const profile = getSurpriseProfile(opts);
    if (profile.stale) return 1.2;
    if (profile.fresh) return 0.92;
    return 1.0;
  }

  ConductorIntelligence.registerTensionBias('HarmonicSurpriseIndex', () => HarmonicSurpriseIndex.getTensionBias(), 0.9, 1.25);

  return {
    getSurpriseProfile,
    getTensionBias
  };
})();
