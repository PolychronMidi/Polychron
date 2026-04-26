// src/conductor/harmonicDensityOscillator.js - Harmonic change rate oscillation tracker.
// Detects periodic oscillation in harmonic density (chord changes per time unit).
// Tension bias to reinforce natural harmonic "breathing" or break stale patterns.
// Pure query API - no side effects.

moduleLifecycle.declare({
  name: 'harmonicDensityOscillator',
  subsystem: 'conductor',
  deps: ['validator'],
  provides: ['harmonicDensityOscillator'],
  init: (deps) => {
  const V = deps.validator.create('harmonicDensityOscillator');
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
   * @returns {{ oscillating: boolean, tensionBias: number, densityBias: number, period: number }}
   */
  function harmonicDensityOscillatorComputeOscillationSignal() {
    if (changeSamples.length < 6) {
      return { oscillating: false, tensionBias: 1, densityBias: 1, period: 0 };
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
    // High alternation (0.4-0.8) - ramp 1.0-1.03 (natural breathing)
    // Low alternation (0-0.15) - ramp 1.08-1.0 (push for change)
    // Mid range - neutral
    let tensionBias = 1;
    if (alternationRate < 0.15) {
      tensionBias = 1.08 - clamp(alternationRate / 0.15, 0, 1) * 0.08;
    } else if (alternationRate > 0.4) {
      tensionBias = 1.0 + clamp((alternationRate - 0.4) / 0.4, 0, 1) * 0.03;
    }

    // R35 E5: Density bias -- cross-domain pathway (harmonic->density).
    // Stale harmony (low alternation) -> suppress density for contrast.
    // Active breathing (high alternation) -> mild density boost.
    let densityBias = 1;
    if (alternationRate < 0.15) {
      densityBias = 0.96 + clamp(alternationRate / 0.15, 0, 1) * 0.04;
    } else if (alternationRate > 0.4) {
      densityBias = 1.0 + clamp((alternationRate - 0.4) / 0.4, 0, 1) * 0.04;
    }

    return { oscillating, tensionBias, densityBias, period };
  }

  const harmonicDensityOscillatorCache = beatCache.create(harmonicDensityOscillatorComputeOscillationSignal);

  /**
   * Detect oscillation pattern in harmonic density (cached per beat).
   * @returns {{ oscillating: boolean, tensionBias: number, densityBias: number, period: number }}
   */
  function getOscillationSignal() { return harmonicDensityOscillatorCache.get(); }

  /**
   * Get tension multiplier for the derivedTension chain.
   * @returns {number}
   */
  function getTensionBias() {
    return getOscillationSignal().tensionBias;
  }

  /**
   * Get density multiplier for the derivedDensity chain.
   * @returns {number}
   */
  function getDensityBias() {
    return getOscillationSignal().densityBias;
  }

  /** Reset tracking. */
  function reset() {
    changeSamples.length = 0;
  }

  conductorIntelligence.registerTensionBias('harmonicDensityOscillator', () => harmonicDensityOscillator.getTensionBias(), 0.9, 1.1);
  conductorIntelligence.registerDensityBias('harmonicDensityOscillator', () => harmonicDensityOscillator.getDensityBias(), 0.96, 1.04);
  conductorIntelligence.registerRecorder('harmonicDensityOscillator', (ctx) => {
    const hr = clamp(V.optionalFinite(ctx.harmonicRhythm, 0.5), 0, 1);
    harmonicDensityOscillator.recordChangeRate(hr, ctx.absTime);
  });
  conductorIntelligence.registerStateProvider('harmonicDensityOscillator', () => ({
    harmonicOscillating: harmonicDensityOscillator.getTensionBias() !== 1
  }));
  conductorIntelligence.registerModule('harmonicDensityOscillator', { reset }, ['section']);

  return {
    recordChangeRate,
    getOscillationSignal,
    getTensionBias,
    getDensityBias,
    reset
  };
  },
});
