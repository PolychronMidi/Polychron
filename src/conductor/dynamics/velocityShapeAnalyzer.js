// src/conductor/dynamics/velocityShapeAnalyzer.js - Unified velocity shape analysis.
// Merges VelocityContourTracker + DynamicEnvelopeShaper.
// Provides velocity contour shape, punchiness, and a single flicker modifier.
// Pure query API - no side effects.

velocityShapeAnalyzer = (() => {
  const V = validator.create('velocityShapeAnalyzer');
  const query = analysisHelpers.createTrackerQuery(V, 5, { minNotes: 4 });

  /**
   * Analyze velocity trajectory and envelope shape.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ slope: number, shape: string, avgVelocity: number, flat: boolean, punchiness: number }}
   */
  function velocityShapeAnalyzerComputeVelocityShape(opts = {}) {
    const notes = query(opts);
    if (!notes) return { slope: 0, shape: 'insufficient', avgVelocity: 64, flat: true, punchiness: 0.5 };

    // Extract velocities
    const velocities = analysisHelpers.extractVelocityArray(notes, 64);

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

  const velocityShapeAnalyzerDefaultShapeCache = beatCache.create(() => velocityShapeAnalyzerComputeVelocityShape());

  /**
   * Analyze velocity trajectory and envelope shape.
   * Default call (no opts) is cached per beat; explicit opts bypass cache.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ slope: number, shape: string, avgVelocity: number, flat: boolean, punchiness: number }}
   */
  function getVelocityShape(opts) {
    if (opts === undefined) return velocityShapeAnalyzerDefaultShapeCache.get();
    return velocityShapeAnalyzerComputeVelocityShape(opts);
  }

  function velocityShapeAnalyzerGetContainmentPressure() {
    const phaseContainmentTarget = 0.09;
    const axisEnergy = pipelineCouplingManager.getAxisEnergyShare();
    const phaseShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.phase === 'number'
      ? axisEnergy.shares.phase
      : 1.0 / 6.0;
    const trustShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.trust === 'number'
      ? axisEnergy.shares.trust
      : 1.0 / 6.0;
    const phaseRecoveryCredit = clamp((phaseShare - phaseContainmentTarget) / 0.05, 0, 1);
    if (phaseRecoveryCredit <= 0) {
      return 0;
    }
    const couplingPressures = pipelineCouplingManager.getCouplingPressures();
    const densityFlickerPressure = clamp((V.optionalFinite(couplingPressures['density-flicker'], 0) - 0.76) / 0.16, 0, 1);
    const flickerPhasePressure = clamp((V.optionalFinite(couplingPressures['flicker-phase'], 0) - 0.74) / 0.16, 0, 1);
    const trustSharePressure = clamp((trustShare - 0.17) / 0.08, 0, 1);
    return clamp((densityFlickerPressure * 0.55 + flickerPhasePressure * 0.25 + trustSharePressure * 0.20) * phaseRecoveryCredit, 0, 1);
  }

  /**
   * Get combined flicker modifier from velocity shape.
   * Continuous ramp based on punchiness and flatness:
   *   flat - 1.15, punchiness 0.6-1.0 - 1.0-1.12,
   *   smooth (punchiness 0-0.2) - 1.0-0.95.
   * Terraced: ramp 1.0-0.92 based on jumpCount severity.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {number} - 0.85 to 1.2
   */
  function getFlickerModifier(opts) {
    const shape = getVelocityShape(opts);
    const containmentPressure = velocityShapeAnalyzerGetContainmentPressure();
    if (shape.shape === 'terraced') {
      // Ramp from 1.0 toward 0.92 based on punchiness (higher punchiness = more terraced)
      return 1.0 - clamp(shape.punchiness, 0, 1) * (0.08 + containmentPressure * 0.03);
    }
    if (shape.flat) {
      // Flat: ramp 1.0-1.15 based on how flat (inverse of punchiness)
      const flatBoost = clamp((0.2 - shape.punchiness) / 0.2, 0, 1) * 0.15;
      return 1.0 + flatBoost * (1 - containmentPressure * 0.55);
    }
    if (shape.punchiness > 0.35) {
      // Punchy: ramp 1.0-1.12 over punchiness 0.35-1.0
      const punchBoost = clamp((shape.punchiness - 0.35) / 0.65, 0, 1) * 0.12;
      return 1.0 + punchBoost * (1 - containmentPressure * 0.65);
    }
    if (shape.punchiness < 0.28) {
      // Smooth: ramp 1.0-0.95 over punchiness 0.28-0
      const smoothCut = clamp((0.28 - shape.punchiness) / 0.28, 0, 1) * 0.05;
      return 1.0 - smoothCut * (1 + containmentPressure * 0.25);
    }
    return 1.0;
  }

  // R10 E3: Register tension bias based on velocity trajectory. Crescendo
  // shapes reinforce tension buildup; decrescendo shapes relax it. This
  // creates coherent coupling between velocity trends and tension direction,
  // making sections with rising velocity also get tension reinforcement.
  function getTensionBias() {
    const shape = getVelocityShape();
    if (shape.shape === 'crescendo') {
      // Rising velocity: ramp 1.0-1.08 based on slope magnitude
      return 1.0 + clamp((shape.slope - 8) / 30, 0, 1) * 0.08;
    }
    if (shape.shape === 'decrescendo') {
      // Falling velocity: ramp 1.0-0.94 based on slope magnitude
      return 1.0 - clamp((m.abs(shape.slope) - 8) / 30, 0, 1) * 0.06;
    }
    if (shape.shape === 'arch') {
      // Arch shape: mild boost for peaked dynamics
      return 1.03;
    }
    return 1.0;
  }

  conductorIntelligence.registerTensionBias('velocityShapeAnalyzer', () => velocityShapeAnalyzer.getTensionBias(), 0.94, 1.08);
  conductorIntelligence.registerFlickerModifier('velocityShapeAnalyzer', () => velocityShapeAnalyzer.getFlickerModifier(), 0.85, 1.2);
  conductorIntelligence.registerStateProvider('velocityShapeAnalyzer', () => {
    const s = velocityShapeAnalyzer.getVelocityShape();
    return { envelopeShape: s ? s.shape : 'neutral' };
  });

  function reset() {}
  conductorIntelligence.registerModule('velocityShapeAnalyzer', { reset }, ['section']);

  return {
    getVelocityShape,
    getFlickerModifier,
    getTensionBias
  };
})();
