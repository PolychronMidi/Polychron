// src/conductor/HarmonicFieldDensityTracker.js - Vertical harmonic density tracker.
// Measures how many simultaneous pitches sound at once (chord thickness)
// and biases density to manage vertical pile-up or thinness.
// Pure query API — no side effects.

HarmonicFieldDensityTracker = (() => {
  const WINDOW_SECONDS = 4;
  const SIMULTANEITY_TOLERANCE = 0.06; // seconds within which notes are "simultaneous"

  /**
   * Analyze vertical density from recent notes.
   * @returns {{ avgSimultaneous: number, maxSimultaneous: number, densityBias: number }}
   */
  function getFieldDensitySignal() {
    const notes = AbsoluteTimeWindow.getNotes({ windowSeconds: WINDOW_SECONDS });

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

    // Density bias: thick vertical texture (>4 simultaneous) → thin out;
    // very thin (<2) → allow thickening
    let densityBias = 1;
    if (avgSimultaneous > 5) {
      densityBias = 0.9; // very dense vertically → reduce
    } else if (avgSimultaneous > 3.5) {
      densityBias = 0.96;
    } else if (avgSimultaneous < 1.5) {
      densityBias = 1.05; // very thin → allow more vertical density
    }

    return { avgSimultaneous, maxSimultaneous: maxSim, densityBias };
  }

  /**
   * Get density multiplier for the targetDensity chain.
   * @returns {number}
   */
  function getDensityBias() {
    return getFieldDensitySignal().densityBias;
  }

  return {
    getFieldDensitySignal,
    getDensityBias
  };
})();
