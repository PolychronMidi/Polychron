// src/conductor/texturalGradientTracker.js - Rate of change in textural density.
// Tracks how fast the composite texture (voices - onset rate) is thickening
// or thinning over time. Biases toward gradual transitions when rate is too
// extreme, or allows sudden changes when dramatically appropriate.
// Pure query API - no side effects.

texturalGradientTracker = (() => {
  const V = validator.create('texturalGradientTracker');
  const MAX_SAMPLES = 16;
  /** @type {Array<{ density: number, time: number }>} */
  const densitySamples = [];

  /**
   * Record a textural density snapshot.
   * @param {number} density - current composite density 0-1
   * @param {number} absTime - absolute time in seconds
   */
  function recordDensity(density, absTime) {
    V.requireFinite(density, 'density');
    V.requireFinite(absTime, 'absTime');
    densitySamples.push({ density: clamp(density, 0, 1), time: absTime });
    if (densitySamples.length > MAX_SAMPLES) densitySamples.shift();
  }

  /**
   * Compute the gradient (rate of change) of textural density.
   * @returns {{ gradient: number, flickerMod: number, suggestion: string }}
   */
  function getGradientSignal() {
    if (densitySamples.length < 3) {
      return { gradient: 0, flickerMod: 1, suggestion: 'stable' };
    }

    // Linear regression slope over recent samples
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;
    const n = densitySamples.length;
    const t0 = densitySamples[0].time;

    for (let i = 0; i < n; i++) {
      const x = densitySamples[i].time - t0;
      const y = densitySamples[i].density;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumXX += x * x;
    }

    const denom = n * sumXX - sumX * sumX;
    const gradient = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;

    // Absolute rate of change - high means rapid texture shift
    const absGradient = m.abs(gradient);

    // flickerMod: rapid changes - widen flicker to accommodate transition,
    // stable - narrow flicker for consistency (continuous ramp, no step)
    let flickerMod = 1;
    // R93 E4 REVERTED (R94 E2): Regime-responsive flickerMod contributed
    // to regime collapse (exploring 41.1%->17.7%) by double-reducing flicker
    // during exploring (combined with regimeReactiveDamping E1). Gradient
    // tracker's natural flickerMod behavior is already well-calibrated.
    if (absGradient > 0.15) {
      flickerMod = clamp(1 + absGradient * 0.3, 1, 1.15);
    } else if (absGradient < 0.03) {
      // Continuous ramp: gradient 0-0.03 maps to flickerMod 0.96-1.0
      // (raised floor from 0.94 to 0.96 to reduce flicker crush)
      flickerMod = 0.96 + (absGradient / 0.03) * 0.04;
    }

    let suggestion = 'stable';
    if (gradient > 0.1) suggestion = 'thickening';
    else if (gradient < -0.1) suggestion = 'thinning';
    else if (absGradient > 0.15) suggestion = 'volatile';

    return { gradient, flickerMod, suggestion };
  }

  /**
   * Get flicker modifier for the flickerAmplitude chain.
   * @returns {number}
   */
  function getFlickerModifier() {
    return getGradientSignal().flickerMod;
  }

  // R25 E4: Tension bias from textural gradient. When texture is thickening
  // (positive gradient), boost tension -- building energy accompanies
  // growing density. When thinning (negative gradient), reduce tension --
  // resolving texture calls for tension release. Creates natural coupling
  // between textural motion and harmonic tension.
  // R26 E2: Narrowed dead zone from +/-0.08 to +/-0.03 -- R25 showed tension
  // stuck at 1.0 while flicker pathway (0.9624) was active. Most gradients
  // fall within +/-0.08, so the original thresholds were too wide.
  /**
   * Get tension multiplier from textural gradient direction.
   * @returns {number}
   */
  function getTensionBias() {
    const s = getGradientSignal();
    if (s.gradient > 0.03) return 1.05;
    if (s.gradient < -0.03) return 0.96;
    return 1.0;
  }

  /** Reset tracking. */
  function reset() {
    densitySamples.length = 0;
  }

  conductorIntelligence.registerFlickerModifier('texturalGradientTracker', () => texturalGradientTracker.getFlickerModifier(), 0.88, 1.20);
  conductorIntelligence.registerTensionBias('texturalGradientTracker', () => texturalGradientTracker.getTensionBias(), 0.96, 1.05);
  conductorIntelligence.registerRecorder('texturalGradientTracker', (ctx) => { texturalGradientTracker.recordDensity(ctx.currentDensity, ctx.absTime); });
  conductorIntelligence.registerModule('texturalGradientTracker', { reset }, ['section']);

  return {
    recordDensity,
    getGradientSignal,
    getFlickerModifier,
    getTensionBias,
    reset
  };
})();
