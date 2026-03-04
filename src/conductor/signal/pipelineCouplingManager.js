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
    'density-entropy':  0.12,  // R16 Evo 1: tightened from 0.20 -- surged to avg 0.338 in R15
    'tension-flicker':  0.15,  // shared compositeIntensity upstream -- aggressive
    'tension-entropy':  0.25,
    'flicker-entropy':  0.18,  // elevated tail (8.8% @0.85) -- tightened
    'flicker-phase':    0.15,  // strongly co-evolving - aggressive decorrelation
    'density-phase':    0.15,  // both section-position-driven -- aggressive
    'tension-phase':    0.30,
    'density-trust':    0.15,  // R17 Evo 2: tightened from 0.18 -- r surged to 0.949 in R16, p95=0.721
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
  const _DENSITY_FLICKER_TARGET_MAX = 0.55;
  /** @type {Record<string, { baseline: number, current: number, rollingAbsCorr: number, rawRollingAbsCorr: number }>} */
  const _adaptiveTargets = {};

  /**
   * Get or create adaptive target state for a pair.
   * @param {string} key
   * @returns {{ baseline: number, current: number, rollingAbsCorr: number, rawRollingAbsCorr: number }}
   */
  function _getAdaptiveTarget(key) {
    if (!_adaptiveTargets[key]) {
      const baseline = PAIR_TARGETS[key] !== undefined ? PAIR_TARGETS[key] : DEFAULT_TARGET;
      _adaptiveTargets[key] = { baseline, current: baseline, rollingAbsCorr: 0, rawRollingAbsCorr: 0 };
    }
    return _adaptiveTargets[key];
  }

  // -- R19 E1: Axis-Centric Coupling Energy Conservation --
  // Per-pair decorrelation is structurally incapable of solving aggregate
  // axis-level coupling because correlation energy is conserved across pairs
  // sharing an axis. Track total |r| per axis; when above ceiling, scale
  // each pair's effective gain proportionally so the dominant pair on each
  // axis receives more decorrelation budget. Prevents whack-a-mole.
  const _AXIS_COUPLING_CEILING = {
    density: 2.0,   // 5 pairs: avg |r|=0.40 per pair at ceiling
    tension: 2.0,
    flicker: 2.0,
    entropy: 2.0,   // entropy is the conservation bottleneck (5 pairs)
    trust:   2.5,   // trust pairs are structurally high, allow more room
    phase:   2.0
  };
  /** @type {Record<string, number>} */
  let _axisTotalAbsR = {};
  /** @type {Record<string, Record<string, number>>} */
  let _axisPairContrib = {};

  // -- Adaptive gain parameters --
  // Every pair starts at GAIN_INIT. Each beat, if |r| > target, we check
  // whether the pair is *improving* (|r| dropped since last beat) or
  // *stuck* (|r| stayed or grew). Stuck - escalate gain. Improving - hold.
  // Below target - relax gain toward GAIN_INIT.
  const GAIN_INIT = 0.16;
  const GAIN_MIN  = 0.08;
  const GAIN_MAX  = 0.60;

  // R9 Evo 3: Profile-aware gain ceiling for density-flicker pair.
  // Explosive profile's flickerTargetRange=0.27 saturates the decorrelation
  // engine (peak |r|=0.951, 14% exceedance >0.85). Allow 30% extra GAIN_MAX
  // for this pair so the engine can actually bring it down.
  let _densityFlickerGainCeiling = GAIN_MAX;
  /** @param {number} scale */
  function setDensityFlickerGainScale(scale) {
    _densityFlickerGainCeiling = GAIN_MAX * scale;
  }

  // -- R20 E2: Global Gain Multiplier (controlled by couplingHomeostasis #12) --
  // Applied to all effective gains and escalation rates. When the whole-system
  // governor detects redistribution (total energy stable while pairs churn),
  // it throttles this multiplier to break the conservation barrier.
  let _globalGainMultiplier = 1.0;
  /** @param {number} scale */
  function setGlobalGainMultiplier(scale) {
    _globalGainMultiplier = clamp(scale, 0.10, 1.0);
  }

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

  // R20 E5: Flicker product sigmoid hysteresis state.
  // 'normal' -> 'guarding' at product < 0.90, 'guarding' -> 'normal' at > 0.96.
  let _flickerGuardState = 'normal';
  // R21 E4: Consecutive beats in guarding state for escalated recovery.
  let _flickerGuardBeats = 0;
  // R21 E4: Flicker-pair gain cap when product is severely compressed.
  const _FLICKER_PAIR_GAIN_CAP = 0.45;
  const _FLICKER_PAIR_GAIN_CAP_THRESHOLD = 0.88;

  // R24 E4: Density product sigmoid hysteresis state.
  // Mirrors flicker guard pattern. 'normal' -> 'guarding' at product < 0.75,
  // 'guarding' -> 'normal' at product > 0.82. Addresses R23 density product
  // drop to 0.707 that went unmitigated.
  let _densityGuardState = 'normal';
  let _densityGuardBeats = 0;
  const _DENSITY_PAIR_GAIN_CAP = 0.45;
  const _DENSITY_PAIR_GAIN_CAP_THRESHOLD = 0.72;

  // R23 E5: High-priority pair gain promotion.
  // When a pair's rawRollingAbsCorr stays above threshold while at GAIN_MAX,
  // temporarily promote it to a higher ceiling. This breaks persistent
  // overcorrelation that the standard ceiling cannot resolve (e.g. density-
  // tension +292% in R22). Only one pair promoted at a time to prevent
  // cascading gain inflation.
  const _HP_GAIN_MAX = 0.80;
  const _HP_ROLLING_THRESHOLD = 0.35;
  const _HP_MAX_BEATS = 50;
  const _HP_COOLDOWN_BEATS = 30;
  /** @type {string | null} */
  let _hpPromotedPair = null;
  let _hpBeats = 0;
  let _hpCooldownRemaining = 0;

  // Per-pair adaptive state: gain, last-observed |r|, and rolling window for p95
  /** @type {Record<string, { gain: number, lastAbsCorr: number, recentAbsCorr: number[], heatPenalty: number, effectivenessEma: number }>} */
  const _pairState = {};

  /** Axes where raw nudge hit the soft limit last beat (gain freeze). */
  /** @type {Set<string>} */
  const _saturatedAxes = new Set();

  /**
   * Get or create adaptive state for a pair.
   * @param {string} key
   * @returns {{ gain: number, lastAbsCorr: number, recentAbsCorr: number[], heatPenalty: number, effectivenessEma: number }}
   */
  function _getPairState(key) {
    if (!_pairState[key]) {
      const initGain = PAIR_GAIN_INIT[key] !== undefined ? PAIR_GAIN_INIT[key] : GAIN_INIT;
      _pairState[key] = { gain: initGain, lastAbsCorr: 0, recentAbsCorr: [], heatPenalty: 0, effectivenessEma: 0.5 };
    }
    return _pairState[key];
  }

  // R11 Evo 2: Rolling p95 for persistent hotspot detection
  const _P95_WINDOW = 16;
  function _computeP95(arr) {
    if (arr.length < 4) return 0;
    const sorted = arr.slice().sort((a, b) => a - b);
    const idx = m.floor(sorted.length * 0.95);
    return sorted[m.min(idx, sorted.length - 1)];
  }

  /**
   * Get target for a pair key. Returns self-calibrated adaptive target (#1).
   * @param {string} key
   * @returns {number}
   */
  function _getTarget(key) {
    return _getAdaptiveTarget(key).current;
  }

  /** @param {string} key */
  function _getTargetMax(key) {
    // R18 E2: Bound target relaxation proportional to baseline.
    // Prevents adaptive targets from drifting to uselessness. density-flicker
    // baseline=0.12 was relaxing up to 0.55 (4.6x), gutting decorrelation.
    // Capping at baseline*2.5 bounds density-flicker to 0.30, density-entropy
    // to 0.30, etc. while leaving higher-baseline pairs unconstrained.
    const globalMax = key === 'density-flicker' ? _DENSITY_FLICKER_TARGET_MAX : _TARGET_MAX;
    const at = _adaptiveTargets[key];
    return at ? m.min(globalMax, at.baseline * 2.5) : globalMax;
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

    // R19 E6: Flicker product floor constraint with R20 E5 hysteresis.
    // When flicker product drops below 0.90 -> enter 'guarding' state.
    // Exit 'guarding' only when product recovers above 0.96.
    // While guarding: apply sigmoid gain reduction AND +0.002/beat recovery
    // nudge toward biasFlicker=1.0 to break the feedback loop.
    // R20 fix: Old threshold 0.92 was too tight (entered immediately at
    // product=0.825 with scalar=0.15, killing 85% of flicker gains while
    // the existing compressed bias persisted -> vicious cycle).
    const _flickerProd = safePreBoot.call(() => signalReader.snapshot()?.flickerProduct, 1.0);
    if (typeof _flickerProd === 'number') {
      if (_flickerGuardState === 'normal' && _flickerProd < 0.90) {
        _flickerGuardState = 'guarding';
        _flickerGuardBeats = 0;
      } else if (_flickerGuardState === 'guarding' && _flickerProd > 0.96) {
        _flickerGuardState = 'normal';
        _flickerGuardBeats = 0;
      }
      // R21 E4: Track consecutive guarding beats for escalation
      if (_flickerGuardState === 'guarding') {
        _flickerGuardBeats++;
      }
    }
    const _flickerGainScalar = _flickerGuardState === 'guarding' && typeof _flickerProd === 'number'
      ? clamp((_flickerProd - 0.80) / 0.12, 0.25, 1.0)
      : 1.0;

    // R24 E4: Density product floor guard (mirrors flicker guard).
    // When density product drops below 0.75, enter guarding state that
    // reduces density-pair gains and nudges biasDensity toward 1.0.
    const _densityProd = safePreBoot.call(() => signalReader.snapshot()?.densityProduct, 1.0);
    if (typeof _densityProd === 'number') {
      if (_densityGuardState === 'normal' && _densityProd < 0.75) {
        _densityGuardState = 'guarding';
        _densityGuardBeats = 0;
      } else if (_densityGuardState === 'guarding' && _densityProd > 0.82) {
        _densityGuardState = 'normal';
        _densityGuardBeats = 0;
      }
      if (_densityGuardState === 'guarding') {
        _densityGuardBeats++;
      }
    }
    const _densityGainScalar = _densityGuardState === 'guarding' && typeof _densityProd === 'number'
      ? clamp((_densityProd - 0.65) / 0.12, 0.25, 1.0)
      : 1.0;

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

    // R19 E1: Pre-pass to compute per-axis total |r| for proportional gain allocation.
    _axisTotalAbsR = {};
    _axisPairContrib = {};
    for (let a = 0; a < ALL_MONITORED_DIMS.length; a++) {
      for (let b = a + 1; b < ALL_MONITORED_DIMS.length; b++) {
        const dA = ALL_MONITORED_DIMS[a];
        const dB = ALL_MONITORED_DIMS[b];
        const k = dA + '-' + dB;
        const cv = matrix[k];
        if (cv === null || cv !== cv) continue;
        const ac = m.abs(cv);
        // Attribute to both axes
        _axisTotalAbsR[dA] = (_axisTotalAbsR[dA] || 0) + ac;
        _axisTotalAbsR[dB] = (_axisTotalAbsR[dB] || 0) + ac;
        if (!_axisPairContrib[dA]) _axisPairContrib[dA] = {};
        if (!_axisPairContrib[dB]) _axisPairContrib[dB] = {};
        _axisPairContrib[dA][k] = ac;
        _axisPairContrib[dB][k] = ac;
      }
    }

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
        const isEntropyPair = (dimA === 'entropy' || dimB === 'entropy');
        const isTensionEntropyPair = (dimA === 'tension' && dimB === 'entropy') || (dimA === 'entropy' && dimB === 'tension');
        const isDensityFlickerPair = key === 'density-flicker';
        let _axisGainScale = 1.0;
        if (absCorr > target) {
          const improving = absCorr < ps.lastAbsCorr - 0.005; // 0.005 deadband
          // Freeze gain if either axis in this pair is saturated -
          // escalating against the soft-limit ceiling wastes the mechanism.
          const pairSaturated = _saturatedAxes.has(dimA) || _saturatedAxes.has(dimB);
          if (!improving && !pairSaturated) {
            // Emergency escalation: when |r| > 2x target, escalate 3x faster
            let rate = absCorr > target * 2 ? GAIN_EMERGENCY_RATE : GAIN_ESCALATE_RATE;
            // R11 Evo 2: Persistent hotspot escalation
            const p95 = _computeP95(ps.recentAbsCorr);
            if (p95 > target * 1.5) {
              rate *= 1.5;
              // R14 Evo 5: Hotspot Heat Penalty Tracking
              ps.heatPenalty = m.min((ps.heatPenalty || 0) + 0.05, 1.0);
            } else {
              ps.heatPenalty = m.max(0, (ps.heatPenalty || 0) - 0.01);
            }
            // R15 Evo 1: Escalate anti-correlation handling for tension-entropy.
            // This pair tends to pin negative; add extra pressure while anti-correlated.
            if (isTensionEntropyPair && corr < 0) {
              rate *= 1.2;
              ps.heatPenalty = m.min((ps.heatPenalty || 0) + 0.03, 1.0);
            }
            // R16 Evo 5 / R17 Evo 5: Graduated density-flicker escalation.
            // Binary threshold at 0.7 over-crushed flicker product to 0.845. Graduated
            // function applies proportional pressure: mild at |r|=0.81, full at |r|=0.95.
            if (isDensityFlickerPair && m.abs(corr) > 0.80) {
              const dfGrad = (m.abs(corr) - 0.80) * 2.0;
              rate *= (1 + dfGrad);
              ps.heatPenalty = m.min((ps.heatPenalty || 0) + dfGrad * 0.1, 1.0);
            }
            // R17 Evo 3 / R18 E3: Universal high-correlation escalation.
            // Catch ANY pair with |r| > 0.85 that has no pair-specific escalator.
            // R18: Removed tension-entropy exclusion. With r=-0.815 resurgence,
            // the pair-specific 1.2x was insufficient; stacking universal 1.15x
            // gives total 1.38x when |r| > 0.85 AND anti-correlated.
            if (!isDensityFlickerPair && m.abs(corr) > 0.85) {
              rate *= 1.15;
              ps.heatPenalty = m.min((ps.heatPenalty || 0) + 0.01, 1.0);
            }
            // R20 E3: Per-pair decorrelation effectiveness gating.
            // When effectiveness EMA < 0.20, the pair is intractable (gain is
            // being spent without reducing |r|). Halve escalation rate to free
            // budget for responsive pairs. Effectiveness survives section resets.
            if ((ps.effectivenessEma || 0.5) < 0.20) {
              rate *= 0.50;
            }
            // R20 E2: Apply global gain multiplier to escalation rate.
            // When homeostasis detects redistribution, slow ALL gains.
            rate *= _globalGainMultiplier;
            let pairGainMax = (key === 'density-flicker') ? _densityFlickerGainCeiling : GAIN_MAX;
            // R23 E5: Allow promoted pair higher gain ceiling.
            if (key === _hpPromotedPair) {
              pairGainMax = m.max(pairGainMax, _HP_GAIN_MAX);
            }
            // R21 E4: Cap flicker-pair gains when product severely compressed.
            // 3 pairs at GAIN_MAX with heat 0.60-0.65 were compressing flicker
            // from multiple directions simultaneously (axis total 1.953).
            if ((dimA === 'flicker' || dimB === 'flicker') && _flickerGuardState === 'guarding' &&
                typeof _flickerProd === 'number' && _flickerProd < _FLICKER_PAIR_GAIN_CAP_THRESHOLD) {
              pairGainMax = m.min(pairGainMax, _FLICKER_PAIR_GAIN_CAP);
            }
            // R24 E4: Density pair gain cap when product severely compressed
            if ((dimA === 'density' || dimB === 'density') && _densityGuardState === 'guarding' &&
                typeof _densityProd === 'number' && _densityProd < _DENSITY_PAIR_GAIN_CAP_THRESHOLD) {
              pairGainMax = m.min(pairGainMax, _DENSITY_PAIR_GAIN_CAP);
            }
            ps.gain = clamp(ps.gain + rate, GAIN_MIN, pairGainMax);
          }

          // R19 E1: Axis-centric proportional gain scaling.
          // When an axis's total |r| exceeds its ceiling, scale this pair's
          // effective gain by its contribution share. Pairs contributing more
          // coupling get more budget; pairs contributing less get throttled.
          // This prevents decorrelating one pair from pumping energy into others.
          _axisGainScale = 1.0;
          const _dimATotal = _axisTotalAbsR[dimA] || 0;
          const _dimBTotal = _axisTotalAbsR[dimB] || 0;
          const _dimACeiling = _AXIS_COUPLING_CEILING[dimA] || 2.0;
          const _dimBCeiling = _AXIS_COUPLING_CEILING[dimB] || 2.0;
          if (_dimATotal > _dimACeiling && _axisPairContrib[dimA]) {
            const pairShare = (_axisPairContrib[dimA][key] || 0) / _dimATotal;
            _axisGainScale = m.min(_axisGainScale, pairShare * (Object.keys(_axisPairContrib[dimA]).length));
          }
          if (_dimBTotal > _dimBCeiling && _axisPairContrib[dimB]) {
            const pairShare = (_axisPairContrib[dimB][key] || 0) / _dimBTotal;
            _axisGainScale = m.min(_axisGainScale, pairShare * (Object.keys(_axisPairContrib[dimB]).length));
          }
          _axisGainScale = clamp(_axisGainScale, 0.15, 1.5);
        } else {
          // Below target - relax gain back toward initial
          // R13 Evo 2: Entropy-Coupling Penalty - faster deadband relaxation rate for entropy
          let relaxRate = isEntropyPair ? GAIN_RELAX_RATE * 2 : GAIN_RELAX_RATE;
          if (isTensionEntropyPair) relaxRate *= 0.35;
          ps.gain = clamp(ps.gain - relaxRate, GAIN_INIT, GAIN_MAX);
          ps.heatPenalty = m.max(0, (ps.heatPenalty || 0) - 0.05);
        }
        // R20 E3: Update per-pair decorrelation effectiveness EMA.
        // Track whether spending gain actually reduced |r|. When a pair has
        // above-average gain and |r| still exceeds target, check if |r| decreased.
        // effectiveness = 1 when |r| decreasing under active gain, 0 when stuck.
        if (ps.gain > GAIN_INIT * 1.2 && absCorr > target) {
          const improved = absCorr < ps.lastAbsCorr ? 1 : 0;
          ps.effectivenessEma = (ps.effectivenessEma || 0.5) * 0.95 + improved * 0.05;
        }
        ps.lastAbsCorr = absCorr;

        // R11 Evo 2: Update rolling |r| window for persistent hotspot tracking
        ps.recentAbsCorr.push(absCorr);
        if (ps.recentAbsCorr.length > _P95_WINDOW) ps.recentAbsCorr.shift();

        // -- #1: Self-calibrate coupling target --
        const at = _getAdaptiveTarget(key);
        // R13 Evo 2: Modulate adapt EMA for entropy pairs tighter to limit runaway phase velocity
        const adaptEma = isEntropyPair ? _TARGET_ADAPT_EMA * 2.5 : _TARGET_ADAPT_EMA;
        at.rollingAbsCorr = at.rollingAbsCorr * (1 - adaptEma) + absCorr * adaptEma;

        // R19 E2: Regime-transparent target adaptation (dual-EMA).
        // Maintain a raw rolling |r| EMA (unscaled by regime) for target self-
        // calibration. During coherent regime, dynamicCoherentRelax masks structural
        // coupling from the effective EMA (rollingAbsCorr). The raw EMA captures
        // true coupling magnitude regardless of regime, enabling timely target
        // tightening/relaxation. Apply 0.8x scaling during coherent to avoid
        // over-aggressive tightening (still captures 80% of structural info).
        const rawEmaInput = regime === 'coherent' ? absCorr * 0.8 : absCorr;
        at.rawRollingAbsCorr = at.rawRollingAbsCorr * (1 - adaptEma) + rawEmaInput * adaptEma;

        // Intractable: raw rolling avg far above target despite near-max gain - relax.
        // R19 E2: Use rawRollingAbsCorr instead of rollingAbsCorr so coherent
        // relaxation cannot mask structural coupling from target calibration.
        if (at.rawRollingAbsCorr > at.current * 1.8 && ps.gain > GAIN_MAX * 0.85) {
          at.current = clamp(at.current + _TARGET_RELAX_RATE, _TARGET_MIN, _getTargetMax(key));
        // Easily resolved: raw rolling avg well below target - tighten toward baseline
        // R19 E4: Density product guard sigmoid. Binary <0.75 gate was blocking ALL
        // density pair tightening when product was 0.7357 (barely below threshold),
        // preventing density-entropy from recovering toward baseline even when resolved.
        // Sigmoid transition allows proportional tightening as product approaches healthy.
        } else if (at.rawRollingAbsCorr < at.current * 0.5) {
          let tightenRate = _TARGET_TIGHTEN_RATE;
          const sig = safePreBoot.call(() => signalReader.snapshot(), null);
          if (sig && (dimA === 'density' || dimB === 'density')) {
            // Sigmoid: at 0.68 -> scalar~0.12, at 0.72 -> 0.50, at 0.75 -> 0.82, at 0.80 -> 0.98
            const _sigScalar = 1 / (1 + m.exp(-25 * (sig.densityProduct - 0.72)));
            tightenRate *= _sigScalar;
          }
          if (tightenRate > 0.0001) {
            at.current = clamp(at.current - tightenRate, _TARGET_MIN, at.baseline);
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

        // R19 E1: Apply axis-centric gain scaling to effective gain
        // R19 E6: Apply flicker product floor scalar to pairs involving flicker
        // R20 E2: Apply global gain multiplier from couplingHomeostasis
        let effectiveGain = ps.gain * _axisGainScale * _globalGainMultiplier;
        if (dimA === 'flicker' || dimB === 'flicker') {
          effectiveGain *= _flickerGainScalar;
        }
        // R24 E4: Density product floor guard scalar
        if (dimA === 'density' || dimB === 'density') {
          effectiveGain *= _densityGainScalar;
        }

        if (aIsNudgeable && bIsNudgeable) {
          const excess = absCorr - target;
          const direction = -m.sign(corr);
          // R14 Evo 5: Escalate magnitude via exponential heat penalty curve
          const heatMulti = 1.0 + m.pow(ps.heatPenalty || 0, 2) * 2.0;
          const magnitude = effectiveGain * excess * heatMulti;

          const half = magnitude * 0.5;
          _addNudge(dimA, -direction * half);
          _addNudge(dimB, direction * half);
        } else {
          const excess = absCorr - target;
          const direction = -m.sign(corr);
          // R14 Evo 5: Escalate magnitude via exponential heat penalty curve
          const heatMulti = 1.0 + m.pow(ps.heatPenalty || 0, 2) * 2.0;
          const magnitude = effectiveGain * excess * heatMulti;

          const nudgeAxis = aIsNudgeable ? dimA : dimB;
          _addNudge(nudgeAxis, direction * magnitude);
        }
      }
    }

    // R23 E5: High-priority pair promotion / demotion / cooldown.
    // After processing all pairs, evaluate whether to promote, maintain, or
    // demote a pair. Only one pair may be promoted at a time.
    if (_hpCooldownRemaining > 0) {
      _hpCooldownRemaining--;
    }
    if (_hpPromotedPair !== null) {
      _hpBeats++;
      const hpAt = _adaptiveTargets[_hpPromotedPair];
      const hpPs = _pairState[_hpPromotedPair];
      // Demote if: beats exceeded, pair resolved, or pair state missing
      const hpResolved = hpAt && hpAt.rawRollingAbsCorr < _HP_ROLLING_THRESHOLD * 0.8;
      // R24 E5: Early demotion when effectiveness drops below threshold.
      // Prevents wasting promotion on intractable pairs.
      const hpLowEffectiveness = hpPs && (hpPs.effectivenessEma || 0.5) < 0.30;
      if (_hpBeats >= _HP_MAX_BEATS || hpResolved || hpLowEffectiveness || !hpAt || !hpPs) {
        // Cap gain back to normal ceiling on demotion
        if (hpPs) {
          const normalMax = (_hpPromotedPair === 'density-flicker') ? _densityFlickerGainCeiling : GAIN_MAX;
          hpPs.gain = m.min(hpPs.gain, normalMax);
        }
        _hpPromotedPair = null;
        _hpBeats = 0;
        _hpCooldownRemaining = _HP_COOLDOWN_BEATS;
      }
    } else if (_hpCooldownRemaining <= 0) {
      // Find worst eligible pair: at GAIN_MAX, rawRollingAbsCorr above threshold
      let worstKey = null;
      let worstRolling = 0;
      const atKeys = Object.keys(_adaptiveTargets);
      for (let i = 0; i < atKeys.length; i++) {
        const ak = atKeys[i];
        const at = _adaptiveTargets[ak];
        const ps = _pairState[ak];
        if (!at || !ps) continue;
        // Must be at or near GAIN_MAX and above rolling threshold
        if (ps.gain >= GAIN_MAX * 0.95 && at.rawRollingAbsCorr > _HP_ROLLING_THRESHOLD) {
          // R24 E5: Only promote nudgeable pairs. In R23, entropy-phase was
          // promoted (gain=0.690) but neither axis is nudgeable -- gain ceiling
          // boost had zero effect since nudge is skipped for non-nudgeable pairs.
          const hpDims = ak.split('-');
          if (!NUDGEABLE_SET.has(hpDims[0]) && !NUDGEABLE_SET.has(hpDims[1])) continue;
          // R24 E5: Require minimum effectiveness before promotion.
          if ((ps.effectivenessEma || 0.5) < 0.35) continue;
          if (at.rawRollingAbsCorr > worstRolling) {
            worstRolling = at.rawRollingAbsCorr;
            worstKey = ak;
          }
        }
      }
      if (worstKey !== null) {
        _hpPromotedPair = worstKey;
        _hpBeats = 0;
      }
    }

    // #9: Budget enforcement - cap per-axis accumulation before soft-limiting
    // to prevent coupling manager from dominating ANY single pipeline.
    // R20 E4: Dynamic axis budget self-calibration. Derive from live total
    // coupling energy so budget auto-scales across profiles. Uses homeostasis
    // totalEnergyEma when available, else falls back to static default.
    let _dynAxisBudget = _AXIS_BUDGET;
    const _homeostasisState = safePreBoot.call(() => couplingHomeostasis.getState(), null);
    if (_homeostasisState && _homeostasisState.totalEnergyEma > 0.1) {
      // Budget = totalEnergy / (3 nudgeable axes * normalizing factor)
      _dynAxisBudget = clamp(_homeostasisState.totalEnergyEma / 15.0, 0.12, 0.36);
    }
    const _dynFlickerBudget = _dynAxisBudget * 1.5;
    if (m.abs(nudgeD) > _dynAxisBudget) nudgeD = m.sign(nudgeD) * _dynAxisBudget;
    if (m.abs(nudgeT) > _dynAxisBudget) nudgeT = m.sign(nudgeT) * _dynAxisBudget;
    if (m.abs(nudgeF) > _dynFlickerBudget) nudgeF = m.sign(nudgeF) * _dynFlickerBudget;

    // Soft-limit: scale accumulated nudges so raw bias stays within the
    // pipeline's clamp envelope. Health-aware: when signalHealthAnalyzer
    // reports strained or worse overall health, expand bandwidth by 0.04
    // to give the coupling manager more room to decorrelate.
    // Without this, the conductor clips silently and the gain keeps
    // escalating against a ceiling, producing max-clamp bias every beat.
    let _softLimit = 0.16; // base max deviation from 1.0 per axis
    const healthGrade = safePreBoot.call(() => signalHealthAnalyzer.getHealth().overall, 'healthy');
    if (healthGrade === 'strained' || healthGrade === 'stressed' || healthGrade === 'critical') {
      _softLimit = 0.20; // expanded bandwidth under system stress
    }

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

    // R20 E5: While in flicker-guarding state, apply a recovery nudge toward
    // biasFlicker=1.0 to break the vicious cycle where compressed bias -> low
    // product -> gain kill -> compressed bias persists.
    // R21 E4: Escalated nudge rate based on consecutive guarding beats.
    // At 0-30 beats: 0.002/beat (original). 30-60: 0.005/beat. 60+: 0.008/beat.
    // R21 showed product=0.847 after full run -- nudge too slow to overcome
    // multi-pair flicker compression from 3 pairs at GAIN_MAX.
    if (_flickerGuardState === 'guarding' && biasFlicker < 0.98) {
      let nudgeRate = 0.002;
      if (_flickerGuardBeats > 60) {
        nudgeRate = 0.008;
      } else if (_flickerGuardBeats > 30) {
        nudgeRate = 0.005;
      }
      biasFlicker = m.min(biasFlicker + nudgeRate, 1.0);
    }
    // R24 E4: Density guard recovery nudge (mirrors flicker guard pattern).
    if (_densityGuardState === 'guarding' && biasDensity < 0.98) {
      let densityNudgeRate = 0.002;
      if (_densityGuardBeats > 60) {
        densityNudgeRate = 0.008;
      } else if (_densityGuardBeats > 30) {
        densityNudgeRate = 0.005;
      }
      biasDensity = m.min(biasDensity + densityNudgeRate, 1.0);
    }
  }

  function densityBias() { return biasDensity; }
  function tensionBias() { return biasTension; }
  function flickerBias() { return biasFlicker; }

  function reset() {
    biasDensity = 1.0;
    biasTension = 1.0;
    biasFlicker = 1.0;
    _saturatedAxes.clear();
    // R18 E6: Warm-start section gains for chronically elevated pairs.
    // For pairs where pre-reset median |r| exceeds target * 2, start
    // the new section at initGain * 1.5 to close the "gift window"
    // where coupling spikes before gain escalation catches up.
    const keys = Object.keys(_pairState);
    for (let i = 0; i < keys.length; i++) {
      const initGain = PAIR_GAIN_INIT[keys[i]] !== undefined ? PAIR_GAIN_INIT[keys[i]] : GAIN_INIT;
      const ps = _pairState[keys[i]];
      let warmGain = initGain;
      if (ps.recentAbsCorr.length >= 4) {
        const sorted = ps.recentAbsCorr.slice().sort((a, b) => a - b);
        const mid = m.floor(sorted.length / 2);
        const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
        const pairTarget = _getAdaptiveTarget(keys[i]).current;
        if (median > pairTarget * 2) {
          warmGain = m.min(initGain * 1.5, GAIN_MAX * 0.6);
        }
      }
      ps.gain = warmGain;
      ps.lastAbsCorr = 0;
      ps.recentAbsCorr = [];
      ps.heatPenalty = 0;
    }
    // #1: Cross-section coupling memory (R17 structural fix).
    // Adaptive targets are NOT reset on section boundaries. The self-calibrating
    // system (#1 hypermeta) accumulates structural knowledge across the full
    // composition. Only tactical state (gains, heatPenalty) resets per section.
    // R18 E4: Graduated dampening by pair drift. Pairs that drifted far above
    // baseline (e.g. density-flicker at 2x+) get heavier dampening (0.3x) to
    // curtail relaxation drift, while well-controlled pairs retain more memory (0.7x).
    const targetKeys = Object.keys(_adaptiveTargets);
    for (let i = 0; i < targetKeys.length; i++) {
      const at = _adaptiveTargets[targetKeys[i]];
      const driftRatio = at.baseline > 0 ? at.current / at.baseline : 1;
      const dampen = driftRatio > 1.5 ? 0.3 : 0.7;
      at.rollingAbsCorr *= dampen;
      at.rawRollingAbsCorr *= dampen;
    }
    // #6: Dampen (not reset) coherent share EMA -- preserves cross-section regime memory
    _coherentShareEma = _coherentShareEma * 0.7 + 0.35 * 0.3;
    // R20 E5: Reset flicker guard to allow fresh assessment per section
    _flickerGuardState = 'normal';
    // R24 E4: Reset density guard per section
    _densityGuardState = 'normal';
    // R23 E5: Reset high-priority promotion state per section
    _hpPromotedPair = null;
    _hpBeats = 0;
    _hpCooldownRemaining = 0;
  }

  // R18 E5 / R19 E1+E2 / R20 E6: Expose adaptive target state for trace diagnostics.
  // Returns per-pair baseline, current, rollingAbsCorr, rawRollingAbsCorr,
  // gain, heatPenalty, effectivenessEma, and per-axis totals for post-run analysis.
  function getAdaptiveTargetSnapshot() {
    /** @type {Record<string, { baseline: number, current: number, rollingAbsCorr: number, rawRollingAbsCorr: number, gain: number, heatPenalty: number, effectivenessEma: number, hpPromoted: boolean }>} */
    const result = {};
    const keys = Object.keys(_adaptiveTargets);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const at = _adaptiveTargets[key];
      const ps = _pairState[key];
      result[key] = {
        baseline: at.baseline,
        current: Number(at.current.toFixed(4)),
        rollingAbsCorr: Number(at.rollingAbsCorr.toFixed(4)),
        rawRollingAbsCorr: Number(at.rawRollingAbsCorr.toFixed(4)),
        gain: ps ? Number(ps.gain.toFixed(4)) : 0,
        heatPenalty: ps ? Number((ps.heatPenalty || 0).toFixed(4)) : 0,
        effectivenessEma: ps ? Number((ps.effectivenessEma || 0.5).toFixed(4)) : 0.5,
        hpPromoted: key === _hpPromotedPair
      };
    }
    return result;
  }

  /**
   * R19 E1: Return per-axis total |r| sums for trace diagnostics.
   * @returns {Record<string, number>}
   */
  function getAxisCouplingTotals() {
    /** @type {Record<string, number>} */
    const result = {};
    const axisKeys = Object.keys(_axisTotalAbsR);
    for (let i = 0; i < axisKeys.length; i++) {
      result[axisKeys[i]] = Number(_axisTotalAbsR[axisKeys[i]].toFixed(4));
    }
    return result;
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

  return { densityBias, tensionBias, flickerBias, setDensityFlickerGainScale, setGlobalGainMultiplier, getAdaptiveTargetSnapshot, getAxisCouplingTotals, reset };
})();
