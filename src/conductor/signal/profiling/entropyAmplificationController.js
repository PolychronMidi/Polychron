// entropyAmplificationController.js - PI controller for entropy variance share targeting.
// Adapts the entropy amplification factor so that entropy contributes ~25% of
// compositional variance in the phase-space trajectory. Prevents entropy from
// dominating or vanishing in the state space due to its inherently higher variance
// compared to multiplicative pipeline products (density/tension/flicker).
//
// Extracted from systemDynamicsProfiler.js for single-responsibility.

entropyAmplificationController = (() => {
  const V = validator.create('entropyAmplificationController');

  // Target variance share for entropy dimension
  const TARGET_SHARE = 0.25;

  // Amplification bounds
  const AMP_MIN = 1.0;   // lowered (was 1.5) - ATW bypass + z-score make dead-axis structurally impossible
  const AMP_MAX = 15.0;

  // EMA smoothing
  const BASE_ALPHA = 0.12;
  const ADAPTIVE_ALPHA_SCALE = 0.08; // converge faster when error is large

  // Integral controller (for zero steady-state error)
  // Regime-responsive: exploring drives harder convergence (entropy naturally
  // volatile), coherent uses gentle correction (entropy share already constrained).
  const KI_BY_REGIME = { exploring: 0.08, evolving: 0.05, coherent: 0.03 };
  const KI_DEFAULT = 0.05;
  const INTEGRAL_CLAMP = 3.0; // anti-windup

  const INITIAL_AMP = 3.0;

  let amp = INITIAL_AMP;
  let integralError = 0;

  /**
   * Adapt entropy amplification via PI controller.
   * Reads the previous beat's entropy variance share and adjusts the amplification
   * factor to steer toward TARGET_SHARE.
   * @param {number} currentShare - entropy's current share of compositional variance (0-1)
   * @param {string} [regime] - current regime for KI selection
   */
  function adapt(currentShare, regime) {
    V.requireFinite(currentShare, 'currentShare');
    const error = TARGET_SHARE - currentShare;

    // Adaptive alpha - converge faster when error is large
    const alpha = BASE_ALPHA + ADAPTIVE_ALPHA_SCALE * m.abs(error);

    // Proportional term
    const pTerm = currentShare < 0.01
      ? AMP_MAX
      : clamp(amp * (TARGET_SHARE / currentShare), AMP_MIN, AMP_MAX);

    // Regime-responsive integral gain
    const ki = KI_BY_REGIME[regime] !== undefined ? KI_BY_REGIME[regime] : KI_DEFAULT;

    // Integral term with anti-windup
    const iTerm = ki * integralError;
    const pDirection = pTerm - amp;
    // Freeze integral when P and I terms have opposite signs
    // to prevent overshoot during error sign transitions.
    if (pDirection * iTerm >= 0) {
      integralError = clamp(integralError + error, -INTEGRAL_CLAMP, INTEGRAL_CLAMP);
    }

    // PI output
    const targetAmp = clamp(pTerm + iTerm, AMP_MIN, AMP_MAX);
    amp = amp * (1 - alpha) + targetAmp * alpha;
  }

  /** @returns {number} current amplification factor */
  function getAmp() { return amp; }

  function reset() {
    amp = INITIAL_AMP;
    integralError = 0;
  }

  return { adapt, getAmp, reset };
})();
