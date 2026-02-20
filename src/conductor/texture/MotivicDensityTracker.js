// src/conductor/MotivicDensityTracker.js - Counts distinct active pitch patterns.
// Detects motivic overcrowding (too many competing fragments) or sparseness.
// Pure query API — biases targetDensity to thin when overcrowded, thicken when sparse.

MotivicDensityTracker = (() => {
  const WINDOW_SECONDS = 4;
  const FRAGMENT_LENGTH = 3; // 3-note pitch-class fragments

  /**
   * Count distinct pitch-class fragments in recent notes.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ distinctFragments: number, totalFragments: number, density: number, overcrowded: boolean, sparse: boolean }}
   */
  function getMotivicProfile(opts) {
    const { layer, windowSeconds } = opts || {};
    const ws = (typeof windowSeconds === 'number' && Number.isFinite(windowSeconds)) ? windowSeconds : WINDOW_SECONDS;

    const fragments = fragmentHelpers.getPCFragments(FRAGMENT_LENGTH, ws, { layer, signed: true });
    if (fragments.length === 0) {
      return { distinctFragments: 0, totalFragments: 0, density: 0, overcrowded: false, sparse: true };
    }

    const seen = /** @type {Object.<string, boolean>} */ ({});
    for (let i = 0; i < fragments.length; i++) {
      seen[fragments[i]] = true;
    }

    const totalFragments = fragments.length;
    const distinctFragments = Object.keys(seen).length;
    const density = totalFragments > 0 ? distinctFragments / totalFragments : 0;

    return {
      distinctFragments,
      totalFragments,
      density,
      overcrowded: distinctFragments > 12 && density > 0.7,
      sparse: distinctFragments < 3
    };
  }

  /**
   * Get a motivic density bias.
   * Overcrowded → thin density; sparse → boost density.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {number} - 0.8 to 1.2
   */
  function getDensityBias(opts) {
    const profile = getMotivicProfile(opts);
    if (profile.overcrowded) return 0.85;
    if (profile.sparse) return 1.15;
    return 1.0;
  }

  ConductorIntelligence.registerDensityBias('MotivicDensityTracker', () => MotivicDensityTracker.getDensityBias(), 0.8, 1.2);

  return {
    getMotivicProfile,
    getDensityBias
  };
})();
