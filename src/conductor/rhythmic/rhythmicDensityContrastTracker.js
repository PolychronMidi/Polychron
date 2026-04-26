// src/conductor/rhythmicDensityContrastTracker.js - Dense vs. sparse passage contrast.
// Measures the contrast between rhythmically dense and sparse passages over time.
// Flicker modifier widens when contrast is healthy, stabilizes when extreme.
// Pure query API - no side effects.

moduleLifecycle.declare({
  name: 'rhythmicDensityContrastTracker',
  subsystem: 'conductor',
  deps: ['validator'],
  provides: ['rhythmicDensityContrastTracker'],
  init: (deps) => {
  const V = deps.validator.create('rhythmicDensityContrastTracker');
  const MAX_SAMPLES = 20;
  /** @type {number[]} */
  const densitySamples = [];

  /**
   * Record a rhythmic density measurement.
   * @param {number} density - 0-1 rhythmic density
   */
  function recordDensity(density) {
    V.requireFinite(density, 'density');
    densitySamples.push(clamp(density, 0, 1));
    if (densitySamples.length > MAX_SAMPLES) densitySamples.shift();
  }

  /**
   * Compute contrast between dense and sparse passages.
   * @returns {{ contrast: number, flickerMod: number, suggestion: string }}
   */
  function rhythmicDensityContrastTrackerComputeContrastSignal() {
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

    // Flicker modifier: continuous ramp based on contrast.
    // Low contrast (0-0.15) - ramp 1.1-1.0 (add variety)
    // Mid contrast (0.15-0.6) - ramp 1.0-1.04 (slight amplification)
    // High contrast (0.6-1.0) - ramp 1.04-0.92 (stabilize)
    let flickerMod = 1;
    if (contrast < 0.15) {
      flickerMod = 1.1 - clamp(contrast / 0.15, 0, 1) * 0.1;
    } else if (contrast > 0.6) {
      flickerMod = 1.04 - clamp((contrast - 0.6) / 0.4, 0, 1) * 0.12;
    } else {
      flickerMod = 1.0 + clamp((contrast - 0.15) / 0.45, 0, 1) * 0.04;
    }

    let suggestion = 'maintain';
    if (contrast < 0.1) suggestion = 'seek-contrast';
    else if (contrast > 0.7) suggestion = 'too-extreme';
    else if (contrast > 0.4) suggestion = 'healthy-contrast';

    return { contrast, flickerMod, suggestion };
  }

  const rhythmicDensityContrastTrackerCache = beatCache.create(rhythmicDensityContrastTrackerComputeContrastSignal);

  /**
   * Compute contrast between dense and sparse passages (cached per beat).
   * @returns {{ contrast: number, flickerMod: number, suggestion: string }}
   */
  function getContrastSignal() { return rhythmicDensityContrastTrackerCache.get(); }

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

  conductorIntelligence.registerFlickerModifier('rhythmicDensityContrastTracker', () => rhythmicDensityContrastTracker.getFlickerModifier(), 0.9, 1.15);
  conductorIntelligence.registerRecorder('rhythmicDensityContrastTracker', (ctx) => { rhythmicDensityContrastTracker.recordDensity(ctx.currentDensity); });
  conductorIntelligence.registerStateProvider('rhythmicDensityContrastTracker', () => {
    const s = rhythmicDensityContrastTracker.getContrastSignal();
    return { rhythmicContrastSuggestion: s ? s.suggestion : 'maintain' };
  });
  conductorIntelligence.registerModule('rhythmicDensityContrastTracker', { reset }, ['section']);

  return {
    recordDensity,
    getContrastSignal,
    getFlickerModifier,
    reset
  };
  },
});
