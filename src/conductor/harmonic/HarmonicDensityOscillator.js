// src/conductor/HarmonicDensityOscillator.js - Harmonic change rate oscillation tracker.
// Detects periodic oscillation in harmonic density (chord changes per time unit).
// Tension bias to reinforce natural harmonic "breathing" or break stale patterns.
// Pure query API - no side effects.

HarmonicDensityOscillator = (() => {
  const V = validator.create('harmonicDensityOscillator');
  const MAX_SAMPLES = 20;
  /** @type {Array<{ changeRate: number, time: number }>} */
  const changeSamples = [];

  /**
   * Record a harmonic change rate snapshot.
   * @param {number} changeRate - chord changes per unit time (0-1 normalized)
   * @param {number} absTime
   */
  function recordChangeRate(changeRate, absTime) {
    V.requireFinite(changeRate, 'changeRate');
    V.requireFinite(absTime, 'absTime');
    changeSamples.push({ changeRate: clamp(changeRate, 0, 1), time: absTime });
    if (changeSamples.length > MAX_SAMPLES) changeSamples.shift();
  }

  /**
   * Detect oscillation pattern in harmonic density.
   * @returns {{ oscillating: boolean, tensionBias: number, period: number }}
   */
  function _computeOscillationSignal() {
    if (changeSamples.length < 6) {
      return { oscillating: false, tensionBias: 1, period: 0 };
    }

    // Check for alternating high/low pattern (simple oscillation detection)
    let alternations = 0;
    let sum = 0;
    for (let i = 0; i < changeSamples.length; i++) sum += changeSamples[i].changeRate;
    const mean = sum / changeSamples.length;

    let prevAbove = changeSamples[0].changeRate > mean;
    for (let i = 1; i < changeSamples.length; i++) {
      const above = changeSamples[i].changeRate > mean;
      if (above !== prevAbove) alternations++;
      prevAbove = above;
    }

    const alternationRate = alternations / (changeSamples.length - 1);
    const oscillating = alternationRate > 0.4;

    // Estimate period from alternation count
    const period = alternations > 0
      ? (changeSamples[changeSamples.length - 1].time - changeSamples[0].time) / (alternations / 2)
      : 0;

    // Tension bias: continuous ramp based on alternation rate.
    // High alternation (0.4→0.8) → ramp 1.0→1.03 (natural breathing)
    // Low alternation (0→0.15) → ramp 1.08→1.0 (push for change)
    // Mid range → neutral
    let tensionBias = 1;
    if (alternationRate < 0.15) {
      tensionBias = 1.08 - clamp(alternationRate / 0.15, 0, 1) * 0.08;
    } else if (alternationRate > 0.4) {
      tensionBias = 1.0 + clamp((alternationRate - 0.4) / 0.4, 0, 1) * 0.03;
    }

    return { oscillating, tensionBias, period };
  }

  const _cache = beatCache.create(_computeOscillationSignal);

  /**
   * Detect oscillation pattern in harmonic density (cached per beat).
   * @returns {{ oscillating: boolean, tensionBias: number, period: number }}
   */
  function getOscillationSignal() { return _cache.get(); }

  /**
   * Get tension multiplier for the derivedTension chain.
   * @returns {number}
   */
  function getTensionBias() {
    return getOscillationSignal().tensionBias;
  }

  /** Reset tracking. */
  function reset() {
    changeSamples.length = 0;
  }

  ConductorIntelligence.registerTensionBias('HarmonicDensityOscillator', () => HarmonicDensityOscillator.getTensionBias(), 0.9, 1.1);
  ConductorIntelligence.registerRecorder('HarmonicDensityOscillator', (ctx) => {
    const hr = clamp(V.optionalFinite(ctx.harmonicRhythm, 0.5), 0, 1);
    HarmonicDensityOscillator.recordChangeRate(hr, ctx.absTime);
  });
  ConductorIntelligence.registerStateProvider('HarmonicDensityOscillator', () => ({
    harmonicOscillating: HarmonicDensityOscillator.getTensionBias() !== 1
  }));
  ConductorIntelligence.registerModule('HarmonicDensityOscillator', { reset }, ['section']);

  return {
    recordChangeRate,
    getOscillationSignal,
    getTensionBias,
    reset
  };
})();
