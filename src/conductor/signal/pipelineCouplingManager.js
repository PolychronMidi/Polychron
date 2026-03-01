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
    'tension-flicker':  0.15,  // shared compositeIntensity upstream -- aggressive
    'tension-entropy':  0.25,
    'flicker-entropy':  0.18,  // elevated tail (8.8% @0.85) -- tightened
    'flicker-phase':    0.15,  // strongly co-evolving - aggressive decorrelation
    'density-phase':    0.15,  // both section-position-driven -- aggressive
    'tension-phase':    0.30,
    'density-trust':    0.18,  // highest avg coupling (0.453) -- aggressive
    'tension-trust':    0.25,
    'flicker-trust':    0.20,  // R7 Evo 6: relaxed from 0.15 -- was over-decorrelating new high-coupling pair
    'entropy-phase':    0.25,  // elevated tail (9.2% @0.85) -- tightened
    'entropy-trust':    0.25,  // tightened for tail control
    'trust-phase':      0.25,  // high tail (7.5% @0.85) -- tightened
  };

  // -- #1: Self-Calibrating Coupling Targets (Hypermeta) --
  // Instead of static PAIR_TARGETS, track rolling |r| per pair and adjust
  // targets upward when correlations are intractable (gain near max) or
  // downward when easily resolved. Eliminates manual target re-tuning.
  const _TARGET_ADAPT_EMA = 0.02;        // ~50-beat horizon for rolling |r|
  const _TARGET_RELAX_RATE = 0.0015;     // per-beat relaxation when intractable (R7 equalized)
  const _TARGET_TIGHTEN_RATE = 0.0015;   // per-beat tightening when resolved (R7 equalized)
  const _TARGET_MIN = 0.08;
  const _TARGET_MAX = 0.45;
  /** @type {Record<string, { baseline: number, current: number, rollingAbsCorr: number }>} */
  const _adaptiveTargets = {};

  /**
   * Get or create adaptive target state for a pair.
   * @param {string} key
   * @returns {{ baseline: number, current: number, rollingAbsCorr: number }}
   */
  function _getAdaptiveTarget(key) {
    if (!_adaptiveTargets[key]) {
      const baseline = PAIR_TARGETS[key] !== undefined ? PAIR_TARGETS[key] : DEFAULT_TARGET;
      _adaptiveTargets[key] = { baseline, current: baseline, rollingAbsCorr: 0 };
    }
    return _adaptiveTargets[key];
  }

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
  const GAIN_RELAX_RATE    = 0.02; // per-beat gain decrease when resolved (raised from 0.01 to prevent gain saturation on intractable pairs)

  // Per-pair initial gain overrides for structurally persistent pairs.
  // density-tension shares many upstream contributors so it starts hotter.
  const PAIR_GAIN_INIT = {
    'density-tension': 0.24
  };

  // Regime-aware target relaxation: in 'coherent' regime, pairwise coupling
  // IS the feature - dimensions deliberately co-evolve. Relax targets so
  // the coupling manager preserves its gain budget for regimes where
  // decorrelation is genuinely needed (exploring, drifting, fragmented).
  // -- #6: Adaptive Coherent Relaxation (Hypermeta) --
  // Derive COHERENT_RELAXATION dynamically from rolling coherent-regime
  // share. When coherent share is below 50%, relax more (coupling IS the
  // feature during scarce coherent); when above 50%, tighten. Supersedes
  // the static constant that required manual tuning every round.
  const _COHERENT_SHARE_EMA_ALPHA = 0.015; // ~64-beat horizon
  let _coherentShareEma = 0.35;            // initial: assume 35% coherent

  // -- #9: Coupling Gain Budget Manager (Hypermeta) --
  // Per-axis budget cap prevents coupling manager from dominating any
  // single pipeline when many pairs simultaneously overcorrelate.
  // R7 Evo 6: Reduced density-flicker and tension-flicker budgets to
  // 0.24 each to accommodate flicker-trust as 4th axis.
  const _AXIS_BUDGET = 0.24;
  const _FLICKER_AXIS_BUDGET = _AXIS_BUDGET * 1.5; // 0.36

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
   * Get target for a pair key. Returns self-calibrated adaptive target (#1).
   * @param {string} key
   * @returns {number}
   */
  function _getTarget(key) {
    return _getAdaptiveTarget(key).current;
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

    // #6: Adaptive coherent relaxation - dynamically derived from regime share
    const regime = snap.regime;
    const isCoherent = regime === 'coherent' ? 1 : 0;
    _coherentShareEma = _coherentShareEma * (1 - _COHERENT_SHARE_EMA_ALPHA) + isCoherent * _COHERENT_SHARE_EMA_ALPHA;
    const dynamicCoherentRelax = 1.0 + m.max(0, 0.50 - _coherentShareEma) * 1.2;
    const targetScale = regime === 'coherent' ? dynamicCoherentRelax : 1.0;

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

        // -- #1: Self-calibrate coupling target --
        const at = _getAdaptiveTarget(key);
        at.rollingAbsCorr = at.rollingAbsCorr * (1 - _TARGET_ADAPT_EMA) + absCorr * _TARGET_ADAPT_EMA;
        // Intractable: rolling avg far above target despite near-max gain - relax
        if (at.rollingAbsCorr > at.current * 1.8 && ps.gain > GAIN_MAX * 0.85) {
          at.current = clamp(at.current + _TARGET_RELAX_RATE, _TARGET_MIN, _TARGET_MAX);
        // Easily resolved: rolling avg well below target - tighten toward baseline
        // R7 Evo 4: Product-feedback guard -- when density product < 0.75,
        // freeze tightening to prevent coupling manager from death-spiraling density.
        } else if (at.rollingAbsCorr < at.current * 0.5) {
          let canTighten = true;
          try {
            const sig = signalReader.snapshot();
            if ((dimA === 'density' || dimB === 'density') && sig.densityProduct < 0.75) canTighten = false;
          } catch { /* pre-boot */ }
          if (canTighten) {
            at.current = clamp(at.current - _TARGET_TIGHTEN_RATE, _TARGET_MIN, at.baseline);
          }
        }

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

    // #9: Budget enforcement - cap per-axis accumulation before soft-limiting
    // to prevent coupling manager from dominating ANY single pipeline.
    if (m.abs(nudgeD) > _AXIS_BUDGET) nudgeD = m.sign(nudgeD) * _AXIS_BUDGET;
    if (m.abs(nudgeT) > _AXIS_BUDGET) nudgeT = m.sign(nudgeT) * _AXIS_BUDGET;
    if (m.abs(nudgeF) > _FLICKER_AXIS_BUDGET) nudgeF = m.sign(nudgeF) * _FLICKER_AXIS_BUDGET;

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

    // Flicker gets wider soft limit (1.5x) to give decorrelation genuine room;
    // its coupling is highest (0.571/0.622) and hits the base ceiling every beat.
    const _flickerSoftLimit = _softLimit * 1.5;

    // Detect saturation BEFORE clamping - used next beat to freeze gains
    _saturatedAxes.clear();
    if (m.abs(nudgeD) >= _softLimit * 0.9) _saturatedAxes.add('density');
    if (m.abs(nudgeT) >= _softLimit * 0.9) _saturatedAxes.add('tension');
    if (m.abs(nudgeF) >= _flickerSoftLimit * 0.9) _saturatedAxes.add('flicker');

    nudgeD = clamp(nudgeD, -_softLimit, _softLimit);
    nudgeT = clamp(nudgeT, -_softLimit, _softLimit);
    nudgeF = clamp(nudgeF, -_flickerSoftLimit, _flickerSoftLimit);

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
    // #1: Reset adaptive targets to baseline on section boundary
    const targetKeys = Object.keys(_adaptiveTargets);
    for (let i = 0; i < targetKeys.length; i++) {
      _adaptiveTargets[targetKeys[i]].current = _adaptiveTargets[targetKeys[i]].baseline;
      _adaptiveTargets[targetKeys[i]].rollingAbsCorr = 0;
    }
    // #6: Reset coherent share EMA
    _coherentShareEma = 0.35;
  }

  // --- Self-registration ---
  // Registered ranges accommodate expanded SOFT_LIMIT (0.20): bias in [0.80, 1.20]
  conductorIntelligence.registerDensityBias('pipelineCouplingManager', densityBias, 0.80, 1.20);
  conductorIntelligence.registerTensionBias('pipelineCouplingManager', tensionBias, 0.80, 1.22);
  conductorIntelligence.registerFlickerModifier('pipelineCouplingManager', flickerBias, 0.70, 1.30);
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
