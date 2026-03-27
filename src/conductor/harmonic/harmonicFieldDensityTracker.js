// src/conductor/harmonicFieldDensityTracker.js - Vertical harmonic density tracker.
// Measures how many simultaneous pitches sound at once (chord thickness)
// and biases density to manage vertical pile-up or thinness.
// Pure query API - no side effects.

harmonicFieldDensityTracker = (() => {
  const WINDOW_SECONDS = 4;
  const SIMULTANEITY_TOLERANCE = 0.06; // seconds within which notes are "simultaneous"

  /**
   * Analyze vertical density from recent notes.
   * @returns {{ avgSimultaneous: number, maxSimultaneous: number, densityBias: number }}
   */
  function harmonicFieldDensityTrackerComputeFieldDensitySignal() {
    const notes = L0.query('note', { windowSeconds: WINDOW_SECONDS });

    if (notes.length < 3) {
      return { avgSimultaneous: 1, maxSimultaneous: 1, densityBias: 1 };
    }

    // Group notes by simultaneous onset
    /** @type {number[]} */
    const clusterSizes = [];
    let clusterStart = 0;

    // Sort by time
    /** @type {Array<{ time: number, midi: number }>} */
    const sorted = [];
    const midis = analysisHelpers.extractMidiArray(notes);
    for (let i = 0; i < notes.length; i++) {
      const t = propertyExtractors.extractFiniteOrDefault(notes[i], 'time', 0);
      const mid = midis[i];
      if (mid >= 0) sorted.push({ time: t, midi: mid });
    }
    sorted.sort((a, b) => a.time - b.time);

    if (sorted.length < 2) {
      return { avgSimultaneous: 1, maxSimultaneous: 1, densityBias: 1 };
    }

    for (let i = 1; i <= sorted.length; i++) {
      if (i === sorted.length || sorted[i].time - sorted[clusterStart].time > SIMULTANEITY_TOLERANCE) {
        clusterSizes.push(i - clusterStart);
        clusterStart = i;
      }
    }

    if (clusterSizes.length === 0) {
      return { avgSimultaneous: 1, maxSimultaneous: 1, densityBias: 1 };
    }

    let sum = 0;
    let maxSim = 0;
    for (let i = 0; i < clusterSizes.length; i++) {
      sum += clusterSizes[i];
      if (clusterSizes[i] > maxSim) maxSim = clusterSizes[i];
    }
    const avgSimultaneous = sum / clusterSizes.length;

    // Continuous ramp: thin texture - boost density; thick - reduce.
    // avgSim 0-2.5 maps to 1.05-1.0; avgSim 2.5-7 maps to 1.0-0.9.
    let densityBias = 1;
    if (avgSimultaneous < 2.5) {
      densityBias = 1.0 + clamp((2.5 - avgSimultaneous) / 2.5, 0, 1) * 0.05;
    } else {
      densityBias = 1.0 - clamp((avgSimultaneous - 2.5) / 4.5, 0, 1) * 0.06; // softened (was 0.10) - permanent 0.90 was chronic drain
    }

    return { avgSimultaneous, maxSimultaneous: maxSim, densityBias };
  }

  const harmonicFieldDensityTrackerCache = beatCache.create(harmonicFieldDensityTrackerComputeFieldDensitySignal);

  /**
   * Analyze vertical density from recent notes (cached per beat).
   * @returns {{ avgSimultaneous: number, maxSimultaneous: number, densityBias: number }}
   */
  function getFieldDensitySignal() { return harmonicFieldDensityTrackerCache.get(); }

  /**
   * Get density multiplier for the targetDensity chain.
   * @returns {number}
   */
  function getDensityBias() {
    return getFieldDensitySignal().densityBias;
  }

  // R27 E5: Flicker modifier from vertical harmonic density. Thick vertical
  // texture (many simultaneous voices) benefits from increased rhythmic
  // variety (higher flicker) to avoid muddy sustained clusters. Thin texture
  // (sparse voicing) benefits from reduced flicker for clarity.
  /**
   * Get flicker modifier from vertical density.
   * @returns {number}
   */
  function getFlickerModifier() {
    const s = getFieldDensitySignal();
    // R34 E3: Dampen flicker boost 1.08->1.04. Flicker axis surged to
    // 0.230 (35% above fair share) in R33, driving axisGini to 0.135.
    // harmonicFieldDensityTracker was contributing 1.08 to the flicker
    // product. Moderate to 1.04 to reduce flicker inflation.
    if (s.avgSimultaneous > 4.0) return 1.04;
    if (s.avgSimultaneous < 1.5) return 0.95;
    return 1.0;
  }

  conductorIntelligence.registerDensityBias('harmonicFieldDensityTracker', () => harmonicFieldDensityTracker.getDensityBias(), 0.94, 1.1);
  conductorIntelligence.registerFlickerModifier('harmonicFieldDensityTracker', () => harmonicFieldDensityTracker.getFlickerModifier(), 0.95, 1.04);
  conductorIntelligence.registerStateProvider('harmonicFieldDensityTracker', () => {
    const s = harmonicFieldDensityTracker.getFieldDensitySignal();
    return { harmonicFieldAvgSimultaneous: s ? s.avgSimultaneous : 1 };
  });

  return {
    getFieldDensitySignal,
    getDensityBias,
    getFlickerModifier
  };
})();
