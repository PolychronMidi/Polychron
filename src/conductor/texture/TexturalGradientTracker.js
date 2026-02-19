// src/conductor/TexturalGradientTracker.js - Rate of change in textural density.
// Tracks how fast the composite texture (voices × onset rate) is thickening
// or thinning over time. Biases toward gradual transitions when rate is too
// extreme, or allows sudden changes when dramatically appropriate.
// Pure query API — no side effects.

TexturalGradientTracker = (() => {
  const MAX_SAMPLES = 16;
  /** @type {Array<{ density: number, time: number }>} */
  const densitySamples = [];

  /**
   * Record a textural density snapshot.
   * @param {number} density - current composite density 0-1
   * @param {number} absTime - absolute time in seconds
   */
  function recordDensity(density, absTime) {
    if (!Number.isFinite(density) || !Number.isFinite(absTime)) return;
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

    // Absolute rate of change — high means rapid texture shift
    const absGradient = m.abs(gradient);

    // flickerMod: rapid changes → widen flicker to accommodate transition,
    // stable → narrow flicker for consistency
    let flickerMod = 1;
    if (absGradient > 0.15) {
      flickerMod = clamp(1 + absGradient * 0.4, 1, 1.25);
    } else if (absGradient < 0.03) {
      flickerMod = 0.92; // very stable → tighten flicker
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

  /** Reset tracking. */
  function reset() {
    densitySamples.length = 0;
  }

  return {
    recordDensity,
    getGradientSignal,
    getFlickerModifier,
    reset
  };
})();
