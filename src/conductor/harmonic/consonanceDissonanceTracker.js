// src/conductor/consonanceDissonanceTracker.js - Interval-quality ratio analysis.
// Measures consonant vs dissonant intervals in simultaneously sounding notes.
// Pure query API - modifies derivedTension to prevent dissonance ruts or blandness.

consonanceDissonanceTracker = (() => {
  const V = validator.create('consonanceDissonanceTracker');
  const WINDOW_SECONDS = 4;
  // Shared consonant intervals from pitchClassHelpers
  const CONSONANT_INTERVALS = pitchClassHelpers.CONSONANT_INTERVALS;

  /**
   * Analyze consonance/dissonance ratio in recent simultaneous notes.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ consonanceRatio: number, dissonanceRatio: number, bland: boolean, harsh: boolean }}
   */
  function getConsonanceProfile(opts = {}) {
    const notes = analysisHelpers.getWindowNotes(V, opts, WINDOW_SECONDS);
    if (notes.length < 3) {
      return { consonanceRatio: 0.5, dissonanceRatio: 0.5, bland: false, harsh: false };
    }
    const midis = analysisHelpers.extractMidiArray(notes, 60);

    let consonant = 0;
    let dissonant = 0;

    // Compare all adjacent note pairs (melodic intervals as proxy)
    for (let i = 1; i < midis.length; i++) {
      const prev = midis[i - 1];
      const curr = midis[i];
      const interval = m.abs(curr - prev) % 12;

      if (CONSONANT_INTERVALS.has(interval)) {
        consonant++;
      } else {
        dissonant++;
      }
    }

    const total = consonant + dissonant;
    if (total === 0) {
      return { consonanceRatio: 0.5, dissonanceRatio: 0.5, bland: false, harsh: false };
    }

    const consonanceRatio = consonant / total;
    const dissonanceRatio = dissonant / total;

    return {
      consonanceRatio,
      dissonanceRatio,
      bland: consonanceRatio > 0.85,
      harsh: dissonanceRatio > 0.6
    };
  }

  /**
   * Get a tension bias based on consonance/dissonance balance.
   * Continuous ramp: consonanceRatio 0.5-1.0 maps to bias 1.0-1.15 (bland-boost);
   * dissonanceRatio 0.3-1.0 maps to bias 1.0-0.85 (harsh-reduce).
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {number} - 0.85 to 1.15
   */
  function getTensionBias(opts) {
    const profile = getConsonanceProfile(opts);
    // R7 E4: Bland side: consonanceRatio 0.5-1.0 - bias 1.0-1.20 (was 1.15).
    // Stronger boost when content is bland creates more harmonic tension.
    if (profile.consonanceRatio > 0.5) {
      return 1.0 + clamp((profile.consonanceRatio - 0.5) / 0.5, 0, 1) * 0.20;
    }
    // R7 E4: Harsh side: dissonanceRatio 0.3-0.8 - bias 1.0-0.80 (was 0.85).
    // Stronger reduction when harsh creates more contrast with consonant passages.
    if (profile.dissonanceRatio > 0.3) {
      return 1.0 - clamp((profile.dissonanceRatio - 0.3) / 0.5, 0, 1) * 0.20;
    }
    return 1.0;
  }

  // R7 E4: Widen registration range from (0.85, 1.15) to (0.80, 1.20)
  conductorIntelligence.registerTensionBias('consonanceDissonanceTracker', () => consonanceDissonanceTracker.getTensionBias(), 0.80, 1.20);

  return {
    getConsonanceProfile,
    getTensionBias
  };
})();
