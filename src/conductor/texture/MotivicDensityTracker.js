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
    const notes = AbsoluteTimeWindow.getNotes({ layer, windowSeconds: ws });
    if (notes.length < FRAGMENT_LENGTH + 1) {
      return { distinctFragments: 0, totalFragments: 0, density: 0, overcrowded: false, sparse: true };
    }

    const seen = /** @type {Object.<string, boolean>} */ ({});
    let totalFragments = 0;

    for (let i = 0; i <= notes.length - FRAGMENT_LENGTH; i++) {
      const fragment = [];
      for (let j = 0; j < FRAGMENT_LENGTH; j++) {
        const pc = (typeof notes[i + j].midi === 'number') ? ((notes[i + j].midi % 12) + 12) % 12 : 0;
        fragment.push(pc);
      }
      // Use interval pattern (direction-agnostic) as the fragment key
      const intervals = [];
      for (let j = 1; j < fragment.length; j++) {
        intervals.push(fragment[j] - fragment[j - 1]);
      }
      const key = intervals.join(',');
      seen[key] = true;
      totalFragments++;
    }

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

  return {
    getMotivicProfile,
    getDensityBias
  };
})();
