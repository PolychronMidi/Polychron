// src/conductor/harmony/chromaticSaturationMonitor.js - Pitch-class coverage tracker.
// Counts how many of the 12 chromatic pitch classes appear in recent material.
// Biases toward variety when diatonic-locked, restraint when over-saturated.
// Pure query API - no side effects.

moduleLifecycle.declare({
  name: 'chromaticSaturationMonitor',
  subsystem: 'conductor',
  deps: ['conductorIntelligence'],
  lazyDeps: ['pitchClassHelpers'],
  provides: ['chromaticSaturationMonitor'],
  init: (deps) => {
  const conductorIntelligence = deps.conductorIntelligence;
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

    // Density bias: under-saturated - encourage more variety (slight density boost),
    let densityBias = 1;
    if (count <= 3) {
      densityBias = 1.08; // very narrow - nudge toward more notes
    } else if (count >= 10) {
      densityBias = 0.93; // very chromatic - pull back slightly
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

  // Tension bias from chromatic saturation. High chromatic
  /**
   * Get tension multiplier from chromatic saturation level.
   * @returns {number}
   */
  function getTensionBias() {
    const s = getSaturationSignal();
    if (s.pitchClassCount >= 10) return 1.06;
    if (s.pitchClassCount <= 2) return 0.95;
    return 1.0;
  }

  conductorIntelligence.registerDensityBias('chromaticSaturationMonitor', () => chromaticSaturationMonitor.getDensityBias(), 0.9, 1.1);
  conductorIntelligence.registerTensionBias('chromaticSaturationMonitor', () => chromaticSaturationMonitor.getTensionBias(), 0.95, 1.06);

  function reset() {}
  conductorIntelligence.registerModule('chromaticSaturationMonitor', { reset }, ['section']);

  return {
    getSaturationSignal,
    getDensityBias,
    getTensionBias
  };
  },
});
