// src/conductor/ChromaticSaturationMonitor.js - Pitch-class coverage tracker.
// Counts how many of the 12 chromatic pitch classes appear in recent material.
// Biases toward variety when diatonic-locked, restraint when over-saturated.
// Pure query API — no side effects.

ChromaticSaturationMonitor = (() => {
  const WINDOW_SECONDS = 8;

  /**
   * Count distinct pitch classes in the recent window.
   * @returns {{ pitchClassCount: number, saturation: number, densityBias: number }}
   */
  function getSaturationSignal() {
    const { counts, total } = pitchClassHelpers.getPitchClassHistogram(WINDOW_SECONDS);

    if (total === 0) {
      return { pitchClassCount: 0, saturation: 0, densityBias: 1 };
    }

    let count = 0;
    for (let i = 0; i < 12; i++) {
      if (counts[i] > 0) count++;
    }

    // Saturation: 0-1 (0 = monochrome, 1 = all 12 PCs present)
    const saturation = count / 12;

    // Density bias: under-saturated → encourage more variety (slight density boost),
    // over-saturated → restrain (slight density reduction)
    // Sweet spot around 5-8 pitch classes (typical diatonic range)
    let densityBias = 1;
    if (count <= 3) {
      densityBias = 1.08; // very narrow — nudge toward more notes
    } else if (count >= 10) {
      densityBias = 0.93; // very chromatic — pull back slightly
    }

    return { pitchClassCount: count, saturation, densityBias };
  }

  /**
   * Get a simple density multiplier for the targetDensity chain.
   * @returns {number}
   */
  function getDensityBias() {
    return getSaturationSignal().densityBias;
  }

  return {
    getSaturationSignal,
    getDensityBias
  };
})();
