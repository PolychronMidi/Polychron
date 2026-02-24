// src/conductor/RhythmicDensityContrastTracker.js - Dense vs. sparse passage contrast.
// Measures the contrast between rhythmically dense and sparse passages over time.
// Flicker modifier widens when contrast is healthy, stabilizes when extreme.
// Pure query API â€” no side effects.

RhythmicDensityContrastTracker = (() => {
  const V = Validator.create('rhythmicDensityContrastTracker');
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
  function _computeContrastSignal() {
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

    // Flicker modifier: healthy contrast (0.2-0.6) â†’ slightly widen flicker;
    // too little contrast â†’ widen to create variety;
    // extreme contrast â†’ tighten for stability
    let flickerMod = 1;
    if (contrast < 0.15) {
      flickerMod = 1.1; // too uniform â†’ add variety via flicker
    } else if (contrast > 0.7) {
      flickerMod = 0.92; // extreme shifts â†’ stabilize
    } else if (contrast > 0.3) {
      flickerMod = 1.04; // healthy contrast â†’ slight amplification
    }

    let suggestion = 'maintain';
    if (contrast < 0.1) suggestion = 'seek-contrast';
    else if (contrast > 0.7) suggestion = 'too-extreme';
    else if (contrast > 0.4) suggestion = 'healthy-contrast';

    return { contrast, flickerMod, suggestion };
  }

  const _cache = beatCache.create(_computeContrastSignal);

  /**
   * Compute contrast between dense and sparse passages (cached per beat).
   * @returns {{ contrast: number, flickerMod: number, suggestion: string }}
   */
  function getContrastSignal() { return _cache.get(); }

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

  ConductorIntelligence.registerFlickerModifier('RhythmicDensityContrastTracker', () => RhythmicDensityContrastTracker.getFlickerModifier(), 0.9, 1.15);
  ConductorIntelligence.registerRecorder('RhythmicDensityContrastTracker', (ctx) => { RhythmicDensityContrastTracker.recordDensity(ctx.currentDensity); });
  ConductorIntelligence.registerStateProvider('RhythmicDensityContrastTracker', () => {
    const s = RhythmicDensityContrastTracker.getContrastSignal();
    return { rhythmicContrastSuggestion: s ? s.suggestion : 'maintain' };
  });
  ConductorIntelligence.registerModule('RhythmicDensityContrastTracker', { reset }, ['section']);

  return {
    recordDensity,
    getContrastSignal,
    getFlickerModifier,
    reset
  };
})();

