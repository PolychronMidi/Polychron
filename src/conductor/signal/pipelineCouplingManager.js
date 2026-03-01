// @ts-check

/**
 * Pipeline Coupling Manager (E6)
 *
 * Self-tuning decorrelation engine for ALL compositional dimension pairs.
 * Reads the full coupling matrix from systemDynamicsProfiler each beat
 * and applies decorrelation nudges to any pair whose |r| exceeds its
 * target. Gains are adaptive: they escalate when nudging fails to reduce
 * coupling (the pair is structurally persistent) and relax when coupling
 * responds. This eliminates the need for manual per-pair gain tuning
 * between runs.
 *
 * Nudgeable axes: density, tension, flicker (conductor biases exist).
 * Entropy has no conductor bias - for pairs involving entropy, the
 * non-entropy partner is nudged.
 */

pipelineCouplingManager = (() => {

  // Dimensions managed by conductor bias pipelines
  const NUDGEABLE = ['density', 'tension', 'flicker'];
  const NUDGEABLE_SET = new Set(NUDGEABLE);

  // The 4 compositional dimensions whose pairs we monitor, plus 2 observable-
  // only dimensions (trust, phase) that are not nudgeable but whose coupling
  // with nudgeable dims must be managed. Phase in particular co-evolves
  // strongly with flicker (r=0.86 observed) and needs active decorrelation.
  const COMPOSITIONAL_DIMS = ['density', 'tension', 'flicker', 'entropy'];
  const OBSERVABLE_DIMS = ['trust', 'phase'];
  const ALL_MONITORED_DIMS = COMPOSITIONAL_DIMS.concat(OBSERVABLE_DIMS);

  // Default coupling target for any compositional pair.
  const DEFAULT_TARGET = 0.25;

  // Per-pair target overrides (targets are structural, not gains).
  const PAIR_TARGETS = {
    'density-tension':  0.15,  // structurally persistent -- needs aggressive target
    'density-flicker':  0.12,  // high tail exceedance (22.8% @0.85) -- aggressive
    'density-entropy':  0.20,  // structural - more notes - entropy shifts
    'tension-flicker':  0.25,
    'tension-entropy':  0.25,
    'flicker-entropy':  0.18,  // elevated tail (8.8% @0.85) -- tightened
    'flicker-phase':    0.15,  // strongly co-evolving - aggressive decorrelation
    'density-phase':    0.30,
    'tension-phase':    0.30,
    'density-trust':    0.18,  // highest avg coupling (0.453) -- aggressive
    'tension-trust':    0.25,
    'flicker-trust':    0.15,  // inflated by flicker flatness -- aggressive
    'entropy-phase':    0.25,  // elevated tail (9.2% @0.85) -- tightened
    'entropy-trust':    0.25,  // tightened for tail control
    'trust-phase':      0.25,  // high tail (7.5% @0.85) -- tightened
  };

  // -- Adaptive gain parameters --
  // Every pair starts at GAIN_INIT. Each beat, if |r| > target, we check
  // whether the pair is *improving* (|r| dropped since last beat) or
  // *stuck* (|r| stayed or grew). Stuck - escalate gain. Improving - hold.
  // Below target - relax gain toward GAIN_INIT.
  const GAIN_INIT = 0.16;
  const GAIN_MIN  = 0.08;
  const GAIN_MAX  = 0.60;
  const GAIN_ESCALATE_RATE = 0.02; // per-beat gain increase when stuck
  const GAIN_EMERGENCY_RATE = 0.06; // 3x escalation when |r| > 2x target
  const GAIN_RELAX_RATE    = 0.01; // per-beat gain decrease when resolved

  // Per-pair initial gain overrides for structurally persistent pairs.
  // density-tension shares many upstream contributors so it starts hotter.
  const PAIR_GAIN_INIT = {
    'density-tension': 0.24
  };

  // Regime-aware target relaxation: in 'coherent' regime, pairwise coupling
  // IS the feature - dimensions deliberately co-evolve. Relax targets so
  // the coupling manager preserves its gain budget for regimes where
  // decorrelation is genuinely needed (exploring, drifting, fragmented).
  const COHERENT_RELAXATION = 1.5;

  // Per-pair adaptive state: gain and last-observed |r|
  /** @type {Record<string, { gain: number, lastAbsCorr: number }>} */
  const _pairState = {};

  /** Axes where raw nudge hit the soft limit last beat (gain freeze). */
  /** @type {Set<string>} */
  const _saturatedAxes = new Set();

  /**
   * Get or create adaptive state for a pair.
   * @param {string} key
   * @returns {{ gain: number, lastAbsCorr: number }}
   */
  function _getPairState(key) {
    if (!_pairState[key]) {
      const initGain = PAIR_GAIN_INIT[key] !== undefined ? PAIR_GAIN_INIT[key] : GAIN_INIT;
      _pairState[key] = { gain: initGain, lastAbsCorr: 0 };
    }
    return _pairState[key];
  }

  /**
   * Get target for a pair key, falling back to default.
   * @param {string} key
   * @returns {number}
   */
  function _getTarget(key) {
    return PAIR_TARGETS[key] !== undefined ? PAIR_TARGETS[key] : DEFAULT_TARGET;
  }

  // Per-pipeline accumulators
  let biasDensity = 1.0;
  let biasTension = 1.0;
  let biasFlicker = 1.0;

  function refresh() {
    const snap = systemDynamicsProfiler.getSnapshot();
    if (!snap || !snap.couplingMatrix) {
      biasDensity = 1.0;
      biasTension = 1.0;
      biasFlicker = 1.0;
      explainabilityBus.emit('COUPLING_SKIP', 'both', { reason: 'no profiler snapshot yet' });
      return;
    }

    // Regime-aware target scaling
    const regime = snap.regime;
    const targetScale = regime === 'coherent' ? COHERENT_RELAXATION : 1.0;

    // Accumulate decorrelation nudges across all overcoupled compositional pairs
    let nudgeD = 0;
    let nudgeT = 0;
    let nudgeF = 0;

    /** @param {string} axis  @param {number} amount */
    function _addNudge(axis, amount) {
      if (axis === 'density') nudgeD += amount;
      else if (axis === 'tension') nudgeT += amount;
      else nudgeF += amount;
    }

    const matrix = snap.couplingMatrix;

    for (let a = 0; a < ALL_MONITORED_DIMS.length; a++) {
      for (let b = a + 1; b < ALL_MONITORED_DIMS.length; b++) {
        const dimA = ALL_MONITORED_DIMS[a];
        const dimB = ALL_MONITORED_DIMS[b];
        const key = dimA + '-' + dimB;
        const corr = matrix[key];
        if (typeof corr !== 'number' || !Number.isFinite(corr)) continue;

        const target = _getTarget(key) * targetScale;
        const absCorr = m.abs(corr);
        const ps = _getPairState(key);

        // -- Adaptive gain logic --
        if (absCorr > target) {
          const improving = absCorr < ps.lastAbsCorr - 0.005; // 0.005 deadband
          // Freeze gain if either axis in this pair is saturated -
          // escalating against the soft-limit ceiling wastes the mechanism.
          const pairSaturated = _saturatedAxes.has(dimA) || _saturatedAxes.has(dimB);
          if (!improving && !pairSaturated) {
            // Emergency escalation: when |r| > 2x target, escalate 3x faster
            const rate = absCorr > target * 2 ? GAIN_EMERGENCY_RATE : GAIN_ESCALATE_RATE;
            ps.gain = clamp(ps.gain + rate, GAIN_MIN, GAIN_MAX);
          }
        } else {
          // Below target - relax gain back toward initial
          ps.gain = clamp(ps.gain - GAIN_RELAX_RATE, GAIN_INIT, GAIN_MAX);
        }
        ps.lastAbsCorr = absCorr;

        // Skip nudge if below target
        if (absCorr <= target) continue;

        // Split decorrelation nudge across BOTH nudgeable axes in opposite
        // directions. Single-axis nudging caused accidental co-movement when
        // multiple pairs pushed the same axis the same way.
        const aIsNudgeable = NUDGEABLE_SET.has(dimA);
        const bIsNudgeable = NUDGEABLE_SET.has(dimB);
        if (!aIsNudgeable && !bIsNudgeable) continue;

        const excess = absCorr - target;
        const direction = -m.sign(corr);
        const magnitude = ps.gain * excess;

        if (aIsNudgeable && bIsNudgeable) {
          const half = magnitude * 0.5;
          _addNudge(dimA, -direction * half);
          _addNudge(dimB, direction * half);
        } else {
          const nudgeAxis = aIsNudgeable ? dimA : dimB;
          _addNudge(nudgeAxis, direction * magnitude);
        }
      }
    }

    // Soft-limit: scale accumulated nudges so raw bias stays within the
    // pipeline's clamp envelope. Health-aware: when signalHealthAnalyzer
    // reports strained or worse overall health, expand bandwidth by 0.04
    // to give the coupling manager more room to decorrelate.
    // Without this, the conductor clips silently and the gain keeps
    // escalating against a ceiling, producing max-clamp bias every beat.
    let _softLimit = 0.16; // base max deviation from 1.0 per axis
    try {
      const healthGrade = signalHealthAnalyzer.getHealth().overall;
      if (healthGrade === 'strained' || healthGrade === 'stressed' || healthGrade === 'critical') {
        _softLimit = 0.20; // expanded bandwidth under system stress
      }
    } catch { /* pre-boot or first beat */ }

    // Detect saturation BEFORE clamping - used next beat to freeze gains
    _saturatedAxes.clear();
    if (m.abs(nudgeD) >= _softLimit * 0.9) _saturatedAxes.add('density');
    if (m.abs(nudgeT) >= _softLimit * 0.9) _saturatedAxes.add('tension');
    if (m.abs(nudgeF) >= _softLimit * 0.9) _saturatedAxes.add('flicker');

    nudgeD = clamp(nudgeD, -_softLimit, _softLimit);
    nudgeT = clamp(nudgeT, -_softLimit, _softLimit);
    nudgeF = clamp(nudgeF, -_softLimit, _softLimit);

    biasDensity = 1.0 + nudgeD;
    biasTension = 1.0 + nudgeT;
    biasFlicker = 1.0 + nudgeF;
  }

  function densityBias() { return biasDensity; }
  function tensionBias() { return biasTension; }
  function flickerBias() { return biasFlicker; }

  function reset() {
    biasDensity = 1.0;
    biasTension = 1.0;
    biasFlicker = 1.0;
    _saturatedAxes.clear();
    // Reset adaptive gains - each section starts fresh
    const keys = Object.keys(_pairState);
    for (let i = 0; i < keys.length; i++) {
      const initGain = PAIR_GAIN_INIT[keys[i]] !== undefined ? PAIR_GAIN_INIT[keys[i]] : GAIN_INIT;
      _pairState[keys[i]].gain = initGain;
      _pairState[keys[i]].lastAbsCorr = 0;
    }
  }

  // --- Self-registration ---
  // Registered ranges accommodate expanded SOFT_LIMIT (0.20): bias in [0.80, 1.20]
  conductorIntelligence.registerDensityBias('pipelineCouplingManager', densityBias, 0.80, 1.20);
  conductorIntelligence.registerTensionBias('pipelineCouplingManager', tensionBias, 0.80, 1.22);
  conductorIntelligence.registerFlickerModifier('pipelineCouplingManager', flickerBias, 0.80, 1.20);
  conductorIntelligence.registerRecorder('pipelineCouplingManager', refresh);
  conductorIntelligence.registerModule('pipelineCouplingManager', { reset }, ['section']);

  feedbackRegistry.registerLoop(
    'pipelineCouplingManager',
    'coupling_matrix',
    'density_tension_flicker',
    () => (m.abs(biasDensity - 1.0) + m.abs(biasTension - 1.0) + m.abs(biasFlicker - 1.0)) / 0.60,
    () => m.sign(biasTension - 1.0)
  );

  return { densityBias, tensionBias, flickerBias, reset };
})();
