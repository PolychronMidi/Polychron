// @ts-check

/**
 * Dimensionality Expander — prevents phase-space collapse.
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
  // fair share. This is the meta-fix: catches ANY dead axis automatically
  // (entropy, or any future axis that goes flat), not just coupling locks.
  const DEAD_AXIS_THRESHOLD = 0.05;
  const DEAD_AXIS_PERTURBATION = 0.08;
  // Mapping from variance index to axis name
  const VARIANCE_AXES = ['density', 'tension', 'flicker']; // entropy (idx 3) has no bias

  let _densityBias = 1.0;
  let _tensionBias = 1.0;
  let _flickerBias = 1.0;
  let _urgency = 0;

  /**
   * Compute the perturbation urgency from effective dimensionality.
   * Returns 0 when healthy, ramps to 1 at critical collapse.
   * @param {number} dim
   * @returns {number}
   */
  function _computeUrgency(dim) {
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
  function _computePerturbations(matrix, urgency) {
    const dPert = 0;
    let tPert = 0;
    let fPert = 0;

    const dt = matrix['density-tension'] || 0;
    const df = matrix['density-flicker'] || 0;
    const tf = matrix['tension-flicker'] || 0;

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
      _densityBias = 1.0;
      _tensionBias = 1.0;
      _flickerBias = 1.0;
      _urgency = 0;
      explainabilityBus.emit('dimensionality-expansion', 'both', { urgency: 0, noData: true });
      return;
    }

    _urgency = _computeUrgency(snap.effectiveDimensionality);

    if (_urgency < 0.01) {
      _densityBias = _densityBias * (1 - SMOOTHING) + SMOOTHING;
      _tensionBias = _tensionBias * (1 - SMOOTHING) + SMOOTHING;
      _flickerBias = _flickerBias * (1 - SMOOTHING) + SMOOTHING;
      explainabilityBus.emit('dimensionality-expansion', 'both', {
        urgency: _urgency,
        effectiveDim: snap.effectiveDimensionality,
        regime: snap.regime,
        status: 'healthy'
      });
      return;
    }

    const pert = _computePerturbations(snap.couplingMatrix, _urgency);

    // --- Dead-axis variance injection (meta-fix) ---
    // If any compositional axis has near-zero variance, inject gentle
    // perturbation to revive it. This fires regardless of coupling state
    // and catches dead axes (like entropy at 0.000) automatically.
    let deadAxisD = 0;
    let deadAxisT = 0;
    let deadAxisF = 0;
    const varRatios = snap.compositionalVariance;
    if (varRatios && varRatios.length >= 3) {
      for (let i = 0; i < VARIANCE_AXES.length; i++) {
        if (varRatios[i] < DEAD_AXIS_THRESHOLD) {
          // Severity scales with how dead the axis is
          const severity = 1 - varRatios[i] / DEAD_AXIS_THRESHOLD;
          const nudge = DEAD_AXIS_PERTURBATION * severity;
          // Alternate direction using beat count to prevent monotonic push
          const dir = (beatCount % 16) < 8 ? 1 : -1;
          if (VARIANCE_AXES[i] === 'density') deadAxisD = dir * nudge;
          else if (VARIANCE_AXES[i] === 'tension') deadAxisT = dir * nudge;
          else deadAxisF = dir * nudge;
        }
      }
    }

    const rawD = 1.0 + pert.density + deadAxisD;
    const rawT = 1.0 + pert.tension + deadAxisT;
    const rawF = 1.0 + pert.flicker + deadAxisF;

    _densityBias = _densityBias * (1 - SMOOTHING) + rawD * SMOOTHING;
    _tensionBias = _tensionBias * (1 - SMOOTHING) + rawT * SMOOTHING;
    _flickerBias = _flickerBias * (1 - SMOOTHING) + rawF * SMOOTHING;

    explainabilityBus.emit('dimensionality-expansion', 'both', {
      urgency: _urgency,
      effectiveDim: snap.effectiveDimensionality,
      regime: snap.regime,
      densityBias: _densityBias,
      tensionBias: _tensionBias,
      flickerBias: _flickerBias,
      deadAxisNudges: { density: deadAxisD, tension: deadAxisT, flicker: deadAxisF }
    });
  }

  function densityBias() { return _densityBias; }
  function tensionBias() { return _tensionBias; }
  function flickerBias() { return _flickerBias; }

  /** @returns {{ urgency: number, densityBias: number, tensionBias: number, flickerBias: number }} */
  function getSnapshot() {
    return { urgency: _urgency, densityBias: _densityBias, tensionBias: _tensionBias, flickerBias: _flickerBias };
  }

  function reset() {
    _densityBias = 1.0;
    _tensionBias = 1.0;
    _flickerBias = 1.0;
    _urgency = 0;
  }

  // --- Self-registration (conductor-side: bias registration is permitted here) ---
  conductorIntelligence.registerDensityBias('dimensionalityExpander', densityBias, 0.85, 1.15);
  conductorIntelligence.registerTensionBias('dimensionalityExpander', tensionBias, 0.85, 1.15);
  conductorIntelligence.registerFlickerModifier('dimensionalityExpander', flickerBias, 0.85, 1.15);
  conductorIntelligence.registerRecorder('dimensionalityExpander', refresh);
  conductorIntelligence.registerModule('dimensionalityExpander', { reset }, ['all', 'section']);

  return { densityBias, tensionBias, flickerBias, getSnapshot, reset };
})();
