// src/conductor/chromaticSaturationMonitor.js - Pitch-class coverage tracker.
// Counts how many of the 12 chromatic pitch classes appear in recent material.
// Biases toward variety when diatonic-locked, restraint when over-saturated.
// Pure query API - no side effects.

moduleLifecycle.declare({
  name: 'chromaticSaturationMonitor',
  subsystem: 'conductor',
  deps: [],
  provides: ['chromaticSaturationMonitor'],
  init: (deps) => {
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
    // over-saturated - restrain (slight density reduction)
    // Sweet spot around 5-8 pitch classes (typical diatonic range)
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

  // R27 E3: Tension bias from chromatic saturation. High chromatic
  // saturation (>=10 PCs) signals harmonic adventurousness and should
  // accompany elevated tension. Low saturation (<=2) signals tonal
  // simplicity and reduced tension. Cross-domain harmonic->tension pathway.
  // R28 E3: Raised low-PC threshold from <=3 to <=2. In R27, saturation at
  // 0.95 (low) combined with rhythmicComplexityGradient (0.95) and
  // intervalExpansionContractor (0.96) over-dampened tension. Narrowing to
  // <=2 means only very sparse pitch material triggers tension reduction.
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
