// src/conductor/dynamics/VelocityShapeAnalyzer.js - Unified velocity shape analysis.
// Merges VelocityContourTracker + DynamicEnvelopeShaper.
// Provides velocity contour shape, punchiness, and a single flicker modifier.
// Pure query API â€” no side effects.

VelocityShapeAnalyzer = (() => {
  const V = Validator.create('velocityShapeAnalyzer');
  const WINDOW_SECONDS = 5;

  /**
   * Analyze velocity trajectory and envelope shape.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ slope: number, shape: string, avgVelocity: number, flat: boolean, punchiness: number }}
   */
  function _computeVelocityShape(opts = {}) {
    const { layer, windowSeconds } = opts;
    const ws = V.optionalFinite(windowSeconds, WINDOW_SECONDS);
    const notes = AbsoluteTimeWindow.getNotes({ layer, windowSeconds: ws });
    if (notes.length < 4) {
      return { slope: 0, shape: 'insufficient', avgVelocity: 64, flat: true, punchiness: 0.5 };
    }

    // Extract velocities
    /** @type {number[]} */
    const velocities = [];
    for (let i = 0; i < notes.length; i++) {
      velocities.push((typeof notes[i].velocity === 'number') ? notes[i].velocity : 64);
    }

    // Half-split slope
    const { slope, avgFirst, avgSecond } = analysisHelpers.halfSplitSlope(velocities);
    const avgVelocity = (avgFirst + avgSecond) / 2;

    // Punchiness: average absolute consecutive velocity difference
    let absDiffSum = 0;
    for (let i = 1; i < velocities.length; i++) {
      absDiffSum += m.abs(velocities[i] - velocities[i - 1]);
    }
    const punchiness = clamp(absDiffSum / ((velocities.length - 1) * 30), 0, 1);

    // Peak position for arch detection
    let peakIdx = 0;
    let peakVel = 0;
    for (let i = 0; i < velocities.length; i++) {
      if (velocities[i] > peakVel) {
        peakVel = velocities[i];
        peakIdx = i;
      }
    }
    const peakPosition = velocities.length > 1 ? peakIdx / (velocities.length - 1) : 0.5;

    // Terraced dynamics detection
    let jumpCount = 0;
    const groupSize = m.max(2, m.floor(velocities.length / 4));
    for (let g = 0; g < velocities.length - groupSize; g += groupSize) {
      let gAvg1 = 0;
      let gAvg2 = 0;
      let g2Count = 0;
      for (let j = 0; j < groupSize; j++) {
        gAvg1 += velocities[g + j];
        if (g + groupSize + j < velocities.length) {
          gAvg2 += velocities[g + groupSize + j];
          g2Count++;
        }
      }
      gAvg1 /= groupSize;
      if (g2Count > 0) gAvg2 /= g2Count;
      if (m.abs(gAvg2 - gAvg1) > 15) jumpCount++;
    }

    // Classify shape
    let shape = 'stable';
    if (jumpCount > 1) shape = 'terraced';
    else if (slope > 8) shape = 'crescendo';
    else if (slope < -8) shape = 'decrescendo';
    else if (punchiness > 0.6) shape = 'punchy';
    else if (punchiness < 0.2) shape = 'smooth';
    else if (peakPosition > 0.3 && peakPosition < 0.7 && m.abs(slope) < 5) shape = 'arch';
    else if (m.abs(slope) < 3) shape = 'flat';

    return {
      slope,
      shape,
      avgVelocity,
      flat: shape === 'flat',
      punchiness
    };
  }

  const _defaultShapeCache = beatCache.create(() => _computeVelocityShape());

  /**
   * Analyze velocity trajectory and envelope shape.
   * Default call (no opts) is cached per beat; explicit opts bypass cache.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ slope: number, shape: string, avgVelocity: number, flat: boolean, punchiness: number }}
   */
  function getVelocityShape(opts) {
    if (opts === undefined) return _defaultShapeCache.get();
    return _computeVelocityShape(opts);
  }

  /**
   * Get combined flicker modifier from velocity shape.
   * Flat â†’ widen; punchy â†’ amplify; terraced â†’ reduce; smooth â†’ dampen.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {number} - 0.85 to 1.2
   */
  function getFlickerModifier(opts) {
    const shape = getVelocityShape(opts);
    if (shape.flat) return 1.15;
    if (shape.shape === 'punchy') return 1.12;
    if (shape.shape === 'terraced') return 0.92;
    if (shape.shape === 'smooth') return 0.95;
    return 1.0;
  }

  ConductorIntelligence.registerFlickerModifier('VelocityShapeAnalyzer', () => VelocityShapeAnalyzer.getFlickerModifier(), 0.85, 1.2);
  ConductorIntelligence.registerStateProvider('VelocityShapeAnalyzer', () => {
    const s = VelocityShapeAnalyzer.getVelocityShape();
    return { envelopeShape: s ? s.shape : 'neutral' };
  });

  return {
    getVelocityShape,
    getFlickerModifier
  };
})();
