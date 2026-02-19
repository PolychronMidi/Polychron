// src/conductor/RhythmicDensityContrastTracker.js - Dense vs. sparse passage contrast.
// Measures the contrast between rhythmically dense and sparse passages over time.
// Flicker modifier widens when contrast is healthy, stabilizes when extreme.
// Pure query API — no side effects.

RhythmicDensityContrastTracker = (() => {
  const MAX_SAMPLES = 20;
  /** @type {number[]} */
  const densitySamples = [];

  /**
   * Record a rhythmic density measurement.
   * @param {number} density - 0-1 rhythmic density
   */
  function recordDensity(density) {
    if (!Number.isFinite(density)) return;
    densitySamples.push(clamp(density, 0, 1));
    if (densitySamples.length > MAX_SAMPLES) densitySamples.shift();
  }

  /**
   * Compute contrast between dense and sparse passages.
   * @returns {{ contrast: number, flickerMod: number, suggestion: string }}
   */
  function getContrastSignal() {
    if (densitySamples.length < 4) {
      return { contrast: 0.5, flickerMod: 1, suggestion: 'maintain' };
    }

    // Find min and max density in recent history
    let minD = 1;
    let maxD = 0;
    for (let i = 0; i < densitySamples.length; i++) {
      if (densitySamples[i] < minD) minD = densitySamples[i];
      if (densitySamples[i] > maxD) maxD = densitySamples[i];
    }

    const contrast = maxD - minD;

    // Flicker modifier: healthy contrast (0.2-0.6) → slightly widen flicker;
    // too little contrast → widen to create variety;
    // extreme contrast → tighten for stability
    let flickerMod = 1;
    if (contrast < 0.15) {
      flickerMod = 1.1; // too uniform → add variety via flicker
    } else if (contrast > 0.7) {
      flickerMod = 0.92; // extreme shifts → stabilize
    } else if (contrast > 0.3) {
      flickerMod = 1.04; // healthy contrast → slight amplification
    }

    let suggestion = 'maintain';
    if (contrast < 0.1) suggestion = 'seek-contrast';
    else if (contrast > 0.7) suggestion = 'too-extreme';
    else if (contrast > 0.4) suggestion = 'healthy-contrast';

    return { contrast, flickerMod, suggestion };
  }

  /**
   * Get flicker modifier for the flickerAmplitude chain.
   * @returns {number}
   */
  function getFlickerModifier() {
    return getContrastSignal().flickerMod;
  }

  /** Reset tracking. */
  function reset() {
    densitySamples.length = 0;
  }

  return {
    recordDensity,
    getContrastSignal,
    getFlickerModifier,
    reset
  };
})();
