

/**
 * Dimensionality Expander - prevents phase-space collapse.
 *
 * When systemDynamicsProfiler reports effectiveDimensionality falling
 * below a threshold, the system has locked into a low-rank trajectory
 * (e.g., "high tension always means low density + high flicker"). This
 * module injects gentle orthogonal perturbations to break correlation
 * locks and restore independent movement along each compositional axis.
 *
 * Strategy: reads the coupling matrix to find the strongest correlations,
 * then nudges the *less dominant* signal in the correlated pair toward
 * an orthogonal direction. The perturbation scales with the severity of
 * the collapse and fades as dimensionality recovers.
 */

dimensionalityExpander = (() => {
  const V = validator.create('dimensionalityExpander');

  // Below this threshold, we begin injecting perturbations.
  const DIM_THRESHOLD = 2.2;
  // Below this, perturbation is at full strength.
  const DIM_CRITICAL = 1.5;
  // Maximum perturbation magnitude per axis.
  const MAX_PERTURBATION = 0.15;
  // EMA smoothing on bias outputs to prevent discontinuous jumps.
  const SMOOTHING = 0.25;
  // Correlation threshold: only break correlations stronger than this.
  const COUPLING_THRESHOLD = 0.30;

  // Dead-axis detection: if a compositional axis contributes less than
  // this fraction of total variance, inject perturbation to revive it.
  // With 4 axes, uniform distribution = 0.25 each; 0.05 means < 20% of
  // fair share. Catches ANY dead nudgeable axis automatically.
  const DEAD_AXIS_THRESHOLD = 0.05;
  const DEAD_AXIS_PERTURBATION = 0.12; // raised (was 0.08) - Run 11: flicker at 3.6% below threshold but nudge too small to produce measurable effect

  // Dominant-axis suppression: mirror of dead-axis detection. If a
  // nudgeable axis exceeds this fraction of total variance, dampen it
  // to restore balance. Without this, a single axis can absorb >50% of
  // variance while overall dimensionality looks healthy (effDim > 2.2).
  const DOMINANT_AXIS_THRESHOLD = 0.35; // lowered (was 0.50) - Run 14: flicker at 39.2% above 25% fair share but below 50% threshold; 0.35 = 1.4* fair share triggers suppression
  const DOMINANT_AXIS_DAMPENING = 0.12;
  const DOMINANT_MIN_NUDGE = 0.02; // floor so threshold boundary produces meaningful force

  // Mapping from variance index to axis name
  const VARIANCE_AXES = ['density', 'tension', 'flicker']; // entropy (idx 3) has no bias

  let dimensionalityExpanderDensityBias = 1.0;
  let dimensionalityExpanderTensionBias = 1.0;
  let dimensionalityExpanderFlickerBias = 1.0;
  let dimensionalityExpanderUrgency = 0;

  /**
   * Compute the perturbation urgency from effective dimensionality.
   * Returns 0 when healthy, ramps to 1 at critical collapse.
   * @param {number} dim
   * @returns {number}
   */
  function dimensionalityExpanderComputeUrgency(dim) {
    if (dim >= DIM_THRESHOLD) return 0;
    if (dim <= DIM_CRITICAL) return 1;
    return (DIM_THRESHOLD - dim) / (DIM_THRESHOLD - DIM_CRITICAL);
  }

  /**
   * Given the coupling matrix, find which axes are over-correlated and
   * compute orthogonal perturbation directions.
   * @param {Record<string, number>} matrix
   * @param {number} urgency
   * @returns {{ density: number, tension: number, flicker: number }}
   */
  function dimensionalityExpanderComputePerturbations(matrix, urgency) {
    const dPert = 0;
    let tPert = 0;
    let fPert = 0;

    const dt = V.optionalFinite(matrix['density-tension'], 0);
    const df = V.optionalFinite(matrix['density-flicker'], 0);
    const tf = V.optionalFinite(matrix['tension-flicker'], 0);

    if (m.abs(dt) > COUPLING_THRESHOLD) {
      const sign = dt > 0 ? -1 : 1;
      tPert += sign * (m.abs(dt) - COUPLING_THRESHOLD) * urgency;
    }

    if (m.abs(tf) > COUPLING_THRESHOLD) {
      const sign = tf > 0 ? -1 : 1;
      fPert += sign * (m.abs(tf) - COUPLING_THRESHOLD) * urgency;
    }

    if (m.abs(df) > COUPLING_THRESHOLD) {
      const sign = df > 0 ? -1 : 1;
      fPert += sign * (m.abs(df) - COUPLING_THRESHOLD) * urgency * 0.5;
    }

    return {
      density: clamp(dPert * MAX_PERTURBATION, -MAX_PERTURBATION, MAX_PERTURBATION),
      tension: clamp(tPert * MAX_PERTURBATION, -MAX_PERTURBATION, MAX_PERTURBATION),
      flicker: clamp(fPert * MAX_PERTURBATION, -MAX_PERTURBATION, MAX_PERTURBATION)
    };
  }

  /** Called each beat as a conductor recorder. */
  function refresh() {
    const snap = systemDynamicsProfiler.getSnapshot();
    if (!snap || !snap.couplingMatrix) {
      dimensionalityExpanderDensityBias = 1.0;
      dimensionalityExpanderTensionBias = 1.0;
      dimensionalityExpanderFlickerBias = 1.0;
      dimensionalityExpanderUrgency = 0;
      explainabilityBus.emit('dimensionality-expansion', 'both', { urgency: 0, noData: true });
      return;
    }

    dimensionalityExpanderUrgency = dimensionalityExpanderComputeUrgency(snap.effectiveDimensionality);

    // Variance balance (runs EVERY beat, independent of urgency)
    // Dead-axis revival + dominant-axis suppression. These fire even when
    // effectiveDimensionality looks healthy (e.g., 3.09) because individual
    // axis imbalance is invisible to overall dimensionality.
    let varD = 0;
    let varT = 0;
    let varF = 0;
    const varRatios = snap.compositionalVariance;
    if (varRatios && varRatios.length >= 3) {
      for (let i = 0; i < VARIANCE_AXES.length; i++) {
        if (varRatios[i] < DEAD_AXIS_THRESHOLD) {
          // Dead axis: persistent upward bias to displace equilibrium.
          // Oscillating nudge was killed by EMA smoothing (averaged to ~0).
          const severity = 1 - varRatios[i] / DEAD_AXIS_THRESHOLD;
          const nudge = DEAD_AXIS_PERTURBATION * severity;
          if (VARIANCE_AXES[i] === 'density') varD = nudge;
          else if (VARIANCE_AXES[i] === 'tension') varT = nudge;
          else varF = nudge;
        } else if (varRatios[i] > DOMINANT_AXIS_THRESHOLD) {
          // Dominant axis: dampen toward fair share (floor prevents paper-wall threshold)
          const excess = varRatios[i] - DOMINANT_AXIS_THRESHOLD;
          const nudge = -m.max(DOMINANT_AXIS_DAMPENING * excess, DOMINANT_MIN_NUDGE);
          if (VARIANCE_AXES[i] === 'density') varD = nudge;
          else if (VARIANCE_AXES[i] === 'tension') varT = nudge;
          else varF = nudge;
        }
      }
    }

    // If dimensionality is healthy and no variance imbalance, smooth toward 1.0
    if (dimensionalityExpanderUrgency < 0.01 && varD === 0 && varT === 0 && varF === 0) {
      dimensionalityExpanderDensityBias = dimensionalityExpanderDensityBias * (1 - SMOOTHING) + SMOOTHING;
      dimensionalityExpanderTensionBias = dimensionalityExpanderTensionBias * (1 - SMOOTHING) + SMOOTHING;
      dimensionalityExpanderFlickerBias = dimensionalityExpanderFlickerBias * (1 - SMOOTHING) + SMOOTHING;
      explainabilityBus.emit('dimensionality-expansion', 'both', {
        urgency: dimensionalityExpanderUrgency,
        effectiveDim: snap.effectiveDimensionality,
        regime: snap.regime,
        status: 'healthy'
      });
      return;
    }

    // Coupling-based perturbations (only when dimensionality is collapsed)
    let pert = { density: 0, tension: 0, flicker: 0 };
    if (dimensionalityExpanderUrgency >= 0.01) {
      pert = dimensionalityExpanderComputePerturbations(snap.couplingMatrix, dimensionalityExpanderUrgency);
    }

    const rawD = 1.0 + pert.density + varD;
    const rawT = 1.0 + pert.tension + varT;
    const rawF = 1.0 + pert.flicker + varF;

    dimensionalityExpanderDensityBias = dimensionalityExpanderDensityBias * (1 - SMOOTHING) + rawD * SMOOTHING;
    dimensionalityExpanderTensionBias = dimensionalityExpanderTensionBias * (1 - SMOOTHING) + rawT * SMOOTHING;
    dimensionalityExpanderFlickerBias = dimensionalityExpanderFlickerBias * (1 - SMOOTHING) + rawF * SMOOTHING;

    explainabilityBus.emit('dimensionality-expansion', 'both', {
      urgency: dimensionalityExpanderUrgency,
      effectiveDim: snap.effectiveDimensionality,
      regime: snap.regime,
      densityBias: dimensionalityExpanderDensityBias,
      tensionBias: dimensionalityExpanderTensionBias,
      flickerBias: dimensionalityExpanderFlickerBias,
      varianceNudges: { density: varD, tension: varT, flicker: varF }
    });
  }

  function densityBias() { return dimensionalityExpanderDensityBias; }
  function tensionBias() { return dimensionalityExpanderTensionBias; }
  function flickerBias() { return dimensionalityExpanderFlickerBias; }

  /** @returns {{ urgency: number, densityBias: number, tensionBias: number, flickerBias: number }} */
  function getSnapshot() {
    return { urgency: dimensionalityExpanderUrgency, densityBias: dimensionalityExpanderDensityBias, tensionBias: dimensionalityExpanderTensionBias, flickerBias: dimensionalityExpanderFlickerBias };
  }

  function reset() {
    dimensionalityExpanderDensityBias = 1.0;
    dimensionalityExpanderTensionBias = 1.0;
    dimensionalityExpanderFlickerBias = 1.0;
    dimensionalityExpanderUrgency = 0;
  }

  // Self-registration (conductor-side: bias registration is permitted here)
  conductorIntelligence.registerDensityBias('dimensionalityExpander', densityBias, 0.85, 1.15);
  conductorIntelligence.registerTensionBias('dimensionalityExpander', tensionBias, 0.85, 1.15);
  conductorIntelligence.registerFlickerModifier('dimensionalityExpander', flickerBias, 0.85, 1.15);
  conductorIntelligence.registerRecorder('dimensionalityExpander', refresh);
  conductorIntelligence.registerModule('dimensionalityExpander', { reset }, ['all', 'section']);

  return { densityBias, tensionBias, flickerBias, getSnapshot, reset };
})();
