// src/conductor/RhythmicComplexityGradient.js - Tracks rhythmic subdivision complexity over time.
// Detects whether the piece is building toward denser subdivisions or simplifying.
// Pure query API â€” advises rhythm pattern tier selection and subdivision depth bias.

RhythmicComplexityGradient = (() => {
  const V = Validator.create('rhythmicComplexityGradient');
  /** @type {Array<{ time: number, complexity: number }>} */
  const samples = [];
  const MAX_SAMPLES = 48;

  /**
   * Record a rhythmic complexity snapshot.
   * Complexity = weighted sum of active subdivision densities.
   * @param {number} complexity - 0-1 normalized complexity value
   * @param {number} time - absolute time in seconds
   */
  function recordComplexity(complexity, time) {
    V.requireFinite(complexity, 'complexity');
    V.requireFinite(time, 'time');
    samples.push({ time, complexity: clamp(complexity, 0, 1) });
    if (samples.length > MAX_SAMPLES) samples.shift();
  }

  /**
   * Compute the gradient (slope) of rhythmic complexity.
   * @returns {{ gradient: number, trend: string, avgComplexity: number, building: boolean, simplifying: boolean }}
   */
  function getGradient() {
    if (samples.length < 4) {
      return { gradient: 0, trend: 'insufficient', avgComplexity: 0.5, building: false, simplifying: false };
    }

    /** @type {number[]} */
    const complexities = [];
    for (let i = 0; i < samples.length; i++) complexities.push(samples[i].complexity);
    const { slope: gradient, avgFirst, avgSecond } = analysisHelpers.halfSplitSlope(complexities);
    const avgComplexity = (avgFirst + avgSecond) / 2;

    let trend = 'stable';
    if (gradient > 0.08) trend = 'building';
    else if (gradient < -0.08) trend = 'simplifying';

    return {
      gradient,
      trend,
      avgComplexity,
      building: gradient > 0.08,
      simplifying: gradient < -0.08
    };
  }

  /**
   * Get a subdivision depth bias based on complexity trajectory.
   * Building â†’ allow deeper subdivisions; simplifying â†’ encourage simpler.
   * @returns {number} - 0.8 to 1.3
   */
  function getSubdivisionBias() {
    const g = getGradient();
    if (g.building) return 1.2;
    if (g.simplifying) return 0.85;
    // If complexity is high and stable, gently encourage simplification
    if (g.avgComplexity > 0.7 && g.trend === 'stable') return 0.9;
    return 1.0;
  }

  /** Reset tracking. */
  function reset() {
    samples.length = 0;
  }

  ConductorIntelligence.registerDensityBias('RhythmicComplexityGradient', () => RhythmicComplexityGradient.getSubdivisionBias(), 0.8, 1.3);
  ConductorIntelligence.registerRecorder('RhythmicComplexityGradient', (ctx) => { RhythmicComplexityGradient.recordComplexity(ctx.currentDensity, ctx.absTime); });
  ConductorIntelligence.registerModule('RhythmicComplexityGradient', { reset }, ['section']);

  return {
    recordComplexity,
    getGradient,
    getSubdivisionBias,
    reset
  };
})();

