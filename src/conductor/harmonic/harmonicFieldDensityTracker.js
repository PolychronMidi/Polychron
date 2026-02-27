// src/conductor/harmonicFieldDensityTracker.js - Vertical harmonic density tracker.
// Measures how many simultaneous pitches sound at once (chord thickness)
// and biases density to manage vertical pile-up or thinness.
// Pure query API - no side effects.

harmonicFieldDensityTracker = (() => {
  const WINDOW_SECONDS = 4;
  const SIMULTANEITY_TOLERANCE = 0.06; // seconds within which notes are "simultaneous"

  /**
   * Analyze vertical density from recent notes.
   * @returns {{ avgSimultaneous: number, maxSimultaneous: number, densityBias: number }}
   */
  function _computeFieldDensitySignal() {
    const notes = absoluteTimeWindow.getNotes({ windowSeconds: WINDOW_SECONDS });

    if (notes.length < 3) {
      return { avgSimultaneous: 1, maxSimultaneous: 1, densityBias: 1 };
    }

    // Group notes by simultaneous onset
    /** @type {number[]} */
    const clusterSizes = [];
    let clusterStart = 0;

    // Sort by time
    /** @type {Array<{ time: number, midi: number }>} */
    const sorted = [];
    for (let i = 0; i < notes.length; i++) {
      const t = (typeof notes[i].time === 'number') ? notes[i].time : 0;
      const mid = (typeof notes[i].midi === 'number') ? notes[i].midi : -1;
      if (mid >= 0) sorted.push({ time: t, midi: mid });
    }
    sorted.sort((a, b) => a.time - b.time);

    if (sorted.length < 2) {
      return { avgSimultaneous: 1, maxSimultaneous: 1, densityBias: 1 };
    }

    for (let i = 1; i <= sorted.length; i++) {
      if (i === sorted.length || sorted[i].time - sorted[clusterStart].time > SIMULTANEITY_TOLERANCE) {
        clusterSizes.push(i - clusterStart);
        clusterStart = i;
      }
    }

    if (clusterSizes.length === 0) {
      return { avgSimultaneous: 1, maxSimultaneous: 1, densityBias: 1 };
    }

    let sum = 0;
    let maxSim = 0;
    for (let i = 0; i < clusterSizes.length; i++) {
      sum += clusterSizes[i];
      if (clusterSizes[i] > maxSim) maxSim = clusterSizes[i];
    }
    const avgSimultaneous = sum / clusterSizes.length;

    // Continuous ramp: thin texture - boost density; thick - reduce.
    // avgSim 0-2.5 maps to 1.05-1.0; avgSim 2.5-7 maps to 1.0-0.9.
    let densityBias = 1;
    if (avgSimultaneous < 2.5) {
      densityBias = 1.0 + clamp((2.5 - avgSimultaneous) / 2.5, 0, 1) * 0.05;
    } else {
      densityBias = 1.0 - clamp((avgSimultaneous - 2.5) / 4.5, 0, 1) * 0.06; // softened (was 0.10) - permanent 0.90 was chronic drain
    }

    return { avgSimultaneous, maxSimultaneous: maxSim, densityBias };
  }

  const _cache = beatCache.create(_computeFieldDensitySignal);

  /**
   * Analyze vertical density from recent notes (cached per beat).
   * @returns {{ avgSimultaneous: number, maxSimultaneous: number, densityBias: number }}
   */
  function getFieldDensitySignal() { return _cache.get(); }

  /**
   * Get density multiplier for the targetDensity chain.
   * @returns {number}
   */
  function getDensityBias() {
    return getFieldDensitySignal().densityBias;
  }

  conductorIntelligence.registerDensityBias('harmonicFieldDensityTracker', () => harmonicFieldDensityTracker.getDensityBias(), 0.9, 1.1);
  conductorIntelligence.registerStateProvider('harmonicFieldDensityTracker', () => {
    const s = harmonicFieldDensityTracker.getFieldDensitySignal();
    return { harmonicFieldAvgSimultaneous: s ? s.avgSimultaneous : 1 };
  });

  return {
    getFieldDensitySignal,
    getDensityBias
  };
})();
