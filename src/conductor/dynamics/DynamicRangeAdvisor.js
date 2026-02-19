// src/conductor/DynamicRangeAdvisor.js - Tracks velocity envelope over time.
// Detects compression (all notes similar velocity) vs. healthy dynamic contrast.
// Pure query API — advises conductor to widen or narrow velocity spread.

DynamicRangeAdvisor = (() => {
  const WINDOW_SECONDS = 4;

  /**
   * Analyze the velocity distribution of recent notes.
   * @param {Object} [opts]
   * @param {string} [opts.layer] - filter by layer
   * @param {number} [opts.windowSeconds] - analysis window
   * @returns {{ min: number, max: number, mean: number, spread: number, compressed: boolean }}
   */
  function getVelocityProfile(opts) {
    const { layer, windowSeconds } = opts || {};
    const ws = (typeof windowSeconds === 'number' && Number.isFinite(windowSeconds)) ? windowSeconds : WINDOW_SECONDS;
    const notes = AbsoluteTimeWindow.getNotes({ layer, windowSeconds: ws });
    if (notes.length < 3) {
      return { min: 64, max: 64, mean: 64, spread: 0, compressed: false };
    }

    let lo = 127;
    let hi = 0;
    let sum = 0;
    for (let i = 0; i < notes.length; i++) {
      const v = (typeof notes[i].velocity === 'number') ? notes[i].velocity : 64;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      sum += v;
    }
    const mean = sum / notes.length;
    const spread = hi - lo;
    const compressed = spread < 20;

    return { min: lo, max: hi, mean, spread, compressed };
  }

  /**
   * Get a velocity-spread bias for the conductor.
   * Returns >1 when dynamics are compressed (encourage wider spread),
   * <1 when dynamics are already wide (allow narrowing).
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {number} - 0.8 to 1.3
   */
  function getSpreadBias(opts) {
    const profile = getVelocityProfile(opts);
    // Compressed → boost spread; wide → slight reduction
    if (profile.compressed) return 1.2;
    if (profile.spread > 60) return 0.85;
    return 1.0;
  }

  /**
   * Suggest velocity adjustment direction.
   * @returns {{ direction: string, magnitude: number }}
   */
  function suggestDynamicShift() {
    const profile = getVelocityProfile();
    if (profile.compressed && profile.mean > 80) {
      return { direction: 'soften', magnitude: 0.3 };
    }
    if (profile.compressed && profile.mean < 50) {
      return { direction: 'brighten', magnitude: 0.3 };
    }
    if (profile.spread > 70) {
      return { direction: 'stabilize', magnitude: 0.15 };
    }
    return { direction: 'maintain', magnitude: 0 };
  }

  return {
    getVelocityProfile,
    getSpreadBias,
    suggestDynamicShift
  };
})();
