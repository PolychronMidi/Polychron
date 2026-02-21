// src/conductor/ConsonanceDissonanceTracker.js - Interval-quality ratio analysis.
// Measures consonant vs dissonant intervals in simultaneously sounding notes.
// Pure query API — modifies derivedTension to prevent dissonance ruts or blandness.

ConsonanceDissonanceTracker = (() => {
  const V = Validator.create('ConsonanceDissonanceTracker');
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
    const { layer, windowSeconds } = opts;
    const ws = V.optionalFinite(windowSeconds, WINDOW_SECONDS);
    const notes = AbsoluteTimeWindow.getNotes({ layer, windowSeconds: ws });
    if (notes.length < 3) {
      return { consonanceRatio: 0.5, dissonanceRatio: 0.5, bland: false, harsh: false };
    }

    let consonant = 0;
    let dissonant = 0;

    // Compare all adjacent note pairs (melodic intervals as proxy)
    for (let i = 1; i < notes.length; i++) {
      const prev = (typeof notes[i - 1].midi === 'number') ? notes[i - 1].midi : 60;
      const curr = (typeof notes[i].midi === 'number') ? notes[i].midi : 60;
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
   * Bland → boost tension for more dissonance; harsh → reduce for more consonance.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {number} - 0.85 to 1.25
   */
  function getTensionBias(opts) {
    const profile = getConsonanceProfile(opts);
    if (profile.bland) return 1.2;
    if (profile.harsh) return 0.85;
    return 1.0;
  }

  ConductorIntelligence.registerTensionBias('ConsonanceDissonanceTracker', () => ConsonanceDissonanceTracker.getTensionBias(), 0.85, 1.25);

  return {
    getConsonanceProfile,
    getTensionBias
  };
})();
