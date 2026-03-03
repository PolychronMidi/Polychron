// regimeClassifier.js - Regime classification with hysteresis for system dynamics.
// Classifies the system's operating mode (stagnant, oscillating, coherent, exploring,
// drifting, fragmented, evolving) from trajectory metrics. Applies hysteresis to prevent
// single-beat noise from flip-flopping regime-reactive damping.
//
// Extracted from systemDynamicsProfiler.js for single-responsibility.

regimeClassifier = (() => {
  const V = validator.create('regimeClassifier');

  // Hysteresis: requires REGIME_HOLD consecutive beats of a new
  // classification before switching.
  const REGIME_HOLD = 5;

  // Profile-adaptive oscillating curvature threshold
  const OSCILLATING_CURVATURE_DEFAULT = 0.55;

  let lastRegime = 'evolving';
  let candidateRegime = 'evolving';
  let candidateCount = 0;
  let exploringBeats = 0; // duration escalator: consecutive exploring beats
  let oscillatingCurvatureThreshold = OSCILLATING_CURVATURE_DEFAULT;
  let coherentThresholdScale = 1.0; // profile-adaptive multiplier

  /**
   * Set the oscillating curvature threshold (profile-adaptive).
   * @param {number} threshold
   */
  function setOscillatingThreshold(threshold) {
    oscillatingCurvatureThreshold = V.requireFinite(threshold, 'threshold');
  }

  /**
   * Set profile-adaptive coherent entry threshold scale.
   * Values < 1.0 make coherent regime easier to enter.
   * @param {number} scale
   */
  function setCoherentThresholdScale(scale) {
    coherentThresholdScale = V.requireFinite(scale, 'coherentThresholdScale');
  }

  /** @returns {number} */
  function getOscillatingThreshold() { return oscillatingCurvatureThreshold; }

  /** @returns {number} */
  function getExploringBeats() { return exploringBeats; }

  /** @returns {string} */
  function getLastRegime() { return lastRegime; }

  /**
   * Classify the current operating regime based on velocity and curvature patterns.
   * @param {number} avgVelocity
   * @param {number} avgCurvature
   * @param {number} effectiveDim
   * @param {number} couplingStrength
   * @returns {string}
   */
  function classify(avgVelocity, avgCurvature, effectiveDim, couplingStrength) {
    // Thresholds calibrated for adaptive STATE_SMOOTHING targeting effective
    // responsiveness ~0.175 (profileSmoothing * stateSmoothing). Validated
    // against explosive (0.5 * 0.35) and default (0.8 * 0.22) profiles.
    // Coupling strength and effectiveDim are scoped to compositional
    // dimensions only (4D, 6 pairs).

    // Stagnant: barely moving through state space
    if (avgVelocity < 0.004) return 'stagnant';
    // Oscillating: high curvature (frequent reversals) with moderate velocity.
    // Threshold is profile-adaptive - explosive tolerates higher curvature.
    if (avgCurvature > oscillatingCurvatureThreshold && avgVelocity < 0.04) return 'oscillating';
    // Coherent: strong coupling + moving (dimensions move together).
    // Checked BEFORE exploring so that coupled high-velocity systems are
    // recognized as coherent rather than stuck in permanent exploring.
    // Coherent momentum: if the system was recently coherent, lower the
    // threshold by 0.05 to make coherence "sticky" (hysteresis bonus).
    // Exploring-duration escalator: the longer the system stays in exploring,
    // the easier it becomes to escape into coherent (self-healing). Every 50
    // exploring beats lowers the threshold by 0.02, down to 0.18 minimum.
    // R7 Evo 5: Coherent entry threshold lowered by 15% to make
    // coherent regime more accessible. Coherent floor: when system has
    // been in exploring for extended periods, further lower the threshold
    // by up to 0.05 based on exploring duration (adds to duration bonus).
    const coherentFloorBonus = exploringBeats > 100 ? clamp((exploringBeats - 100) * 0.0005, 0, 0.05) : 0;
    const durationBonus = lastRegime === 'exploring' ? clamp(m.floor(exploringBeats / 50) * 0.02, 0, 0.12) : 0;

    // R14 Evo 2: Exploring Convergence Acceleration
    // Force transition to evolving or coherent faster if stuck exploring for > 32 beats
    let convergenceBonus = 0;
    if (lastRegime === 'exploring' && exploringBeats > 32) {
      convergenceBonus = clamp((exploringBeats - 32) * 0.005, 0, 0.15);
    }

    const baseCoherentThreshold = (lastRegime === 'coherent' ? 0.25 : 0.30) * 0.85 * coherentThresholdScale; // R7 Evo 5: 15% reduction, profile-scaled
    const coherentThreshold = baseCoherentThreshold - durationBonus - coherentFloorBonus - convergenceBonus;
    if (couplingStrength > coherentThreshold && avgVelocity > 0.008) return 'coherent';
    // Exploring: high velocity + multi-dimensional + weak coupling.
    // Gate widened (0.30 -> 0.40) so moderately-coupled systems can escape
    // exploring into coherent more easily.
    if (avgVelocity > 0.02 && effectiveDim > 2.5 && couplingStrength <= 0.40) return 'exploring';
    // Exploring -> evolving transition: sustained coupling increase while
    // exploring triggers evolving rather than jumping straight to coherent.
    // This creates richer regime lifecycle: exploring -> evolving -> coherent.
    if (lastRegime === 'exploring' && avgVelocity > 0.008 && couplingStrength > 0.15) return 'evolving';
    // Fragmented: weak coupling + multi-dimensional (dimensions independent + noisy)
    if (couplingStrength < 0.15 && effectiveDim > 2.5) return 'fragmented';
    // Drifting: moderate velocity, low curvature (slow one-directional change)
    if (avgCurvature < 0.2 && avgVelocity > 0.008) return 'drifting';
    return 'evolving';
  }

  /**
   * Apply hysteresis to regime transitions.
   * Requires REGIME_HOLD consecutive beats of a new classification before switching.
   * @param {string} rawRegime - instantaneous classification from classify()
   * @returns {string} - stable regime with hysteresis
   */
  function resolve(rawRegime) {
    if (rawRegime === lastRegime) {
      candidateRegime = rawRegime;
      candidateCount = 0;
      if (lastRegime === 'exploring') exploringBeats++;
      return lastRegime;
    }
    if (rawRegime === candidateRegime) {
      candidateCount++;
      if (candidateCount >= REGIME_HOLD) {
        if (lastRegime === 'exploring') exploringBeats = 0;
        lastRegime = rawRegime;
        candidateCount = 0;
        return rawRegime;
      }
    } else {
      candidateRegime = rawRegime;
      candidateCount = 1;
    }
    return lastRegime;
  }

  /**
   * Grade the trajectory health.
   * @param {string} regime
   * @returns {string}
   */
  function grade(regime) {
    if (regime === 'exploring' || regime === 'coherent' || regime === 'evolving') return 'healthy';
    if (regime === 'drifting' || regime === 'fragmented') return 'strained';
    if (regime === 'oscillating') return 'stressed';
    if (regime === 'stagnant') return 'critical';
    return 'healthy';
  }

  function reset() {
    lastRegime = 'evolving';
    candidateRegime = 'evolving';
    candidateCount = 0;
    exploringBeats = 0;
    oscillatingCurvatureThreshold = OSCILLATING_CURVATURE_DEFAULT;
    coherentThresholdScale = 1.0;
  }

  return { classify, resolve, grade, setOscillatingThreshold, getOscillatingThreshold, setCoherentThresholdScale, getExploringBeats, getLastRegime, reset };
})();
