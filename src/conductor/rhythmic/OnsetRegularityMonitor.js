// src/conductor/OnsetRegularityMonitor.js - Inter-onset-interval (IOI) regularity analysis.
// Detects metronomic uniformity vs. rhythmic chaos in onset timing.
// Pure query API — biases toward variety when IOI is too uniform, stabilizes when chaotic.

OnsetRegularityMonitor = (() => {
  const WINDOW_SECONDS = 4;

  /**
   * Compute IOI regularity from recent onsets.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ avgIOI: number, ioiCV: number, regularity: number, uniform: boolean, chaotic: boolean }}
   */
  function getRegularityProfile(opts) {
    const { layer, windowSeconds } = opts || {};
    const ws = (typeof windowSeconds === 'number' && Number.isFinite(windowSeconds)) ? windowSeconds : WINDOW_SECONDS;
    const notes = AbsoluteTimeWindow.getNotes({ layer, windowSeconds: ws });
    if (notes.length < 4) {
      return { avgIOI: 0, ioiCV: 0, regularity: 0.5, uniform: false, chaotic: false };
    }

    const iois = beatGridHelpers.getRecentIOIs(notes);

    if (iois.length < 2) {
      return { avgIOI: 0, ioiCV: 0, regularity: 0.5, uniform: false, chaotic: false };
    }

    // Mean IOI
    let sum = 0;
    for (let i = 0; i < iois.length; i++) sum += iois[i];
    const avgIOI = sum / iois.length;

    // Standard deviation
    let sqDiffSum = 0;
    for (let i = 0; i < iois.length; i++) {
      const diff = iois[i] - avgIOI;
      sqDiffSum += diff * diff;
    }
    const stddev = m.sqrt(sqDiffSum / iois.length);

    // Coefficient of variation (0 = perfectly regular, higher = more variable)
    const ioiCV = avgIOI > 0 ? stddev / avgIOI : 0;

    // Regularity score (1 = metronomic, 0 = chaotic)
    const regularity = clamp(1 - ioiCV, 0, 1);

    return {
      avgIOI,
      ioiCV,
      regularity,
      uniform: regularity > 0.85,
      chaotic: regularity < 0.35
    };
  }

  /**
   * Get a rhythm variety bias.
   * Uniform → encourage variation; chaotic → encourage stabilization.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {number} - 0.85 to 1.25
   */
  function getRhythmVarietyBias(opts) {
    const profile = getRegularityProfile(opts);
    if (profile.uniform) return 1.2;   // Boost variety
    if (profile.chaotic) return 0.85;  // Encourage stability
    return 1.0;
  }

  return {
    getRegularityProfile,
    getRhythmVarietyBias
  };
})();
