// src/conductor/harmonicSurpriseIndex.js - Chord-progression predictability analysis.
// Measures pitch-class transition entropy in the ATW window.
// High entropy = surprising/fresh; low entropy = predictable/stale.
// Pure query API - biases derivedTension toward harmonic freshness.

harmonicSurpriseIndex = (() => {
  const V = validator.create('harmonicSurpriseIndex');
  const WINDOW_SECONDS = 6;

  /**
   * Compute pitch-class transition entropy from recent notes.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ entropy: number, surpriseIndex: number, stale: boolean, fresh: boolean }}
   */
  function getSurpriseProfile(opts = {}) {
    const notes = analysisHelpers.getWindowNotes(V, opts, WINDOW_SECONDS);
    if (notes.length < 4) {
      return { entropy: 0, surpriseIndex: 0.5, stale: false, fresh: false };
    }
    const pitchClasses = analysisHelpers.extractPCArray(analysisHelpers.extractMidiArray(notes, 0), 0);

    // Build pitch-class bigram transition counts
    const transitionCounts = /** @type {Object.<string, number>} */ ({});
    let totalTransitions = 0;

    for (let i = 1; i < pitchClasses.length; i++) {
      const prevPC = pitchClasses[i - 1];
      const currPC = pitchClasses[i];
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

    // Normalize: max possible entropy for 144 bigrams (12x12) ~= 7.17
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
   * Continuous ramp: surpriseIndex 0-0.25 - bias 1.2-1.0 (stale-neutral);
   * surpriseIndex 0.65-1.0 - bias 1.0-0.92 (fresh-reduce).
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {number} - 0.9 to 1.25
   */
  function getTensionBias(opts) {
    const profile = getSurpriseProfile(opts);
    if (profile.surpriseIndex < 0.25) {
      // Stale: 0-0.25 maps to 1.2-1.0
      return 1.2 - clamp(profile.surpriseIndex / 0.25, 0, 1) * 0.2;
    }
    if (profile.surpriseIndex > 0.65) {
      // R7 E3: Fresh: 0.65-1.0 maps to 1.0-0.88 (was 0.92). Wider reduction
      // for fresh harmonic content creates more dynamic contrast between
      // predictable and surprising passages.
      return 1.0 - clamp((profile.surpriseIndex - 0.65) / 0.35, 0, 1) * 0.12;
    }
    return 1.0;
  }

  // R7 E3: Widen registration range from (0.9, 1.25) to (0.88, 1.25)
  conductorIntelligence.registerTensionBias('harmonicSurpriseIndex', () => harmonicSurpriseIndex.getTensionBias(), 0.88, 1.25);

  return {
    getSurpriseProfile,
    getTensionBias
  };
})();
