// src/conductor/analysisHelpers.js - Shared analysis utilities.
// Used by VelocityShapeAnalyzer, DurationalContourTracker, EnergyMomentumTracker,
// RegisterMigrationTracker, PhraseLengthMomentumTracker, RhythmicComplexityGradient.
// Pure, stateless helpers — no side effects, no ATW dependency.

analysisHelpers = (() => {
  /**
   * Split an array of numbers in half and return the slope (avgSecond - avgFirst).
   * Standard half-split slope for detecting crescendo/decrescendo, acceleration, etc.
   * @param {number[]} values - array of numeric samples (velocities, durations, energies, etc.)
   * @returns {{ slope: number, avgFirst: number, avgSecond: number }}
   */
  function halfSplitSlope(values) {
    if (values.length < 4) return { slope: 0, avgFirst: 0, avgSecond: 0 };
    const half = m.ceil(values.length / 2);
    let sumFirst = 0;
    let sumSecond = 0;
    for (let i = 0; i < half; i++) sumFirst += values[i];
    for (let i = half; i < values.length; i++) sumSecond += values[i];
    const avgFirst = sumFirst / half;
    const avgSecond = sumSecond / (values.length - half);
    return { slope: avgSecond - avgFirst, avgFirst, avgSecond };
  }

  return { halfSplitSlope };
})();
