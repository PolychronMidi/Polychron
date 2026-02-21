// src/conductor/CounterpointMotionTracker.js - Inter-layer melodic motion classification.
// Classifies note-pairs across L1/L2 as parallel, contrary, oblique, or similar motion.
// Pure query API — composers use to favor underused motion types.

CounterpointMotionTracker = (() => {
  const V = Validator.create('CounterpointMotionTracker');
  const WINDOW_SECONDS = 4;

  /**
   * Classify inter-layer melodic motion in the recent window.
   * @param {number} [windowSeconds]
   * @returns {{ parallel: number, contrary: number, oblique: number, similar: number, total: number, dominant: string }}
   */
  function getMotionProfile(windowSeconds) {
    const ws = V.optionalFinite(windowSeconds, WINDOW_SECONDS);
    const l1Notes = AbsoluteTimeWindow.getNotes({ layer: 'L1', windowSeconds: ws });
    const l2Notes = AbsoluteTimeWindow.getNotes({ layer: 'L2', windowSeconds: ws });
    if (l1Notes.length < 3 || l2Notes.length < 3) {
      return { parallel: 0, contrary: 0, oblique: 0, similar: 0, total: 0, dominant: 'insufficient' };
    }

    // Build time-aligned motion pairs using nearest-neighbor matching
    let parallel = 0;
    let contrary = 0;
    let oblique = 0;
    let similar = 0;
    let l2Idx = 0;

    for (let i = 1; i < l1Notes.length; i++) {
      const l1Prev = (typeof l1Notes[i - 1].midi === 'number') ? l1Notes[i - 1].midi : 60;
      const l1Curr = (typeof l1Notes[i].midi === 'number') ? l1Notes[i].midi : 60;
      const l1Dir = l1Curr - l1Prev;

      // Find closest L2 note pair near this time
      while (l2Idx < l2Notes.length - 1 && l2Notes[l2Idx + 1].time < l1Notes[i - 1].time) {
        l2Idx++;
      }
      if (l2Idx >= l2Notes.length - 1) break;

      const l2Prev = (typeof l2Notes[l2Idx].midi === 'number') ? l2Notes[l2Idx].midi : 60;
      const l2Curr = (typeof l2Notes[l2Idx + 1].midi === 'number') ? l2Notes[l2Idx + 1].midi : 60;
      const l2Dir = l2Curr - l2Prev;

      if (l1Dir === 0 || l2Dir === 0) {
        oblique++;
      } else if ((l1Dir > 0 && l2Dir > 0) || (l1Dir < 0 && l2Dir < 0)) {
        // Same direction — parallel if same interval size, similar otherwise
        if (m.abs(l1Dir) === m.abs(l2Dir)) parallel++;
        else similar++;
      } else {
        contrary++;
      }
    }

    const total = parallel + contrary + oblique + similar;
    if (total === 0) {
      return { parallel: 0, contrary: 0, oblique: 0, similar: 0, total: 0, dominant: 'insufficient' };
    }

    // Determine dominant motion type
    const counts = { parallel, contrary, oblique, similar };
    let dominant = 'mixed';
    let maxCount = 0;
    const keys = Object.keys(counts);
    for (let i = 0; i < keys.length; i++) {
      const c = counts[/** @type {keyof counts} */ (keys[i])];
      if (c > maxCount) {
        maxCount = c;
        dominant = keys[i];
      }
    }
    // Only dominant if >50% of total
    if (maxCount / total < 0.5) dominant = 'mixed';

    return { parallel, contrary, oblique, similar, total, dominant };
  }

  /**
   * Get a motion-type bias to encourage contrapuntal variety.
   * @returns {{ parallelBias: number, contraryBias: number }}
   */
  function getMotionBias() {
    const profile = getMotionProfile();
    if (profile.dominant === 'parallel') {
      return { parallelBias: 0.8, contraryBias: 1.3 };
    }
    if (profile.dominant === 'contrary') {
      return { parallelBias: 1.2, contraryBias: 0.9 };
    }
    return { parallelBias: 1.0, contraryBias: 1.0 };
  }

  ConductorIntelligence.registerStateProvider('CounterpointMotionTracker', () => {
    const b = CounterpointMotionTracker.getMotionBias();
    return {
      counterpointParallelBias: b ? b.parallelBias : 1,
      counterpointContraryBias: b ? b.contraryBias : 1
    };
  });

  return {
    getMotionProfile,
    getMotionBias
  };
})();
