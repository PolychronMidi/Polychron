// @ts-check

/**
 * Axis Energy Equilibrator (R28 E7) -- Hypermeta Self-Calibrating Controller #13
 *
 * The structural cause of whack-a-mole in Polychron's coupling system is that
 * manually tightening pair targets on one axis cluster (e.g. trust pairs)
 * redirects decorrelation energy to other axis clusters (e.g. phase pairs).
 * This has been observed across R24-R27:
 *   R24: Phase targets tightened -> R25 trust pairs surged
 *   R26: Trust targets tightened -> R27 phase pairs surged +192%
 *
 * This controller monitors the per-axis energy distribution (via
 * pipelineCouplingManager.getAxisEnergyShare()) and automatically adjusts
 * pair baselines to equalize axis energy. When an axis consumes a
 * disproportionate share of coupling energy (> threshold), pairs on that
 * axis have their baselines tightened. When an axis is over-suppressed
 * (< fair share), baselines relax.
 *
 * Operates per-measure (via recorder) with conservative rates to avoid
 * oscillation. Does NOT produce pipeline biases -- it modulates the coupling
 * manager's internal targets only.
 *
 * Hypermeta controller #13: axisEnergyEquilibrator
 * Axes: density, tension, flicker, entropy, trust, phase
 * Interacts with: #1 (selfCalibratingCouplingTargets -- the targets it modifies),
 *                 #9 (couplingGainBudgetManager), #12 (couplingHomeostasis)
 */

axisEnergyEquilibrator = (() => {
  const V = validator.create('axisEnergyEquilibrator');

  // -- Configuration --

  // Fair share: 1/6 axes = 0.1667. Overshoot threshold at 1.8x fair share.
  const _FAIR_SHARE = 1.0 / 6.0;
  // Axis is overloaded when its energy share exceeds this threshold
  const _OVERSHOOT_THRESHOLD = 0.28;
  // Axis is suppressed when its energy share falls below this threshold
  const _UNDERSHOOT_THRESHOLD = 0.08;

  // Per-beat baseline adjustment rates (conservative to prevent oscillation)
  const _TIGHTEN_RATE = 0.0008;   // ~125 beats to move baseline by 0.10
  const _RELAX_RATE = 0.0004;     // relaxation at half the tighten rate (asymmetric)

  // Minimum beats between adjustments to the same pair (anti-oscillation)
  const _COOLDOWN_BEATS = 8;

  // EMA for smoothed axis energy shares (prevents single-beat spikes from triggering)
  const _SHARE_EMA_ALPHA = 0.06;  // ~16-beat horizon

  // Gini guard: when axis Gini exceeds this, strengthen equalization pressure
  const _GINI_ESCALATION_THRESHOLD = 0.50;
  const _GINI_ESCALATION_MULTIPLIER = 1.5;

  // Absolute baseline bounds (same as pipelineCouplingManager's _TARGET_MIN/_TARGET_MAX)
  const _BASELINE_MIN = 0.04;
  const _BASELINE_MAX = 0.40;

  // -- State --

  /** @type {Record<string, number>} Smoothed axis energy shares */
  const _smoothedShares = {};
  /** @type {Record<string, number>} Per-pair cooldown counters */
  const _pairCooldowns = {};
  let _beatCount = 0;
  let _adjustmentCount = 0;
  /** @type {Record<string, number>} Running count of adjustments per axis */
  const _axisAdjustments = {};
  /** @type {Record<string, number>} Last snapshot of baselines before adjustment */
  let _lastBaselines = {};

  // Dimensions and their pair memberships (precomputed)
  const _ALL_AXES = ['density', 'tension', 'flicker', 'entropy', 'trust', 'phase'];
  /** @type {Record<string, string[]>} axis -> list of pair keys containing that axis */
  const _axisToPairs = {};
  // Build axis-to-pair mapping from all 15 pairs
  const _ALL_PAIRS = [
    'density-tension', 'density-flicker', 'density-entropy', 'density-phase', 'density-trust',
    'tension-flicker', 'tension-entropy', 'tension-phase', 'tension-trust',
    'flicker-entropy', 'flicker-phase', 'flicker-trust',
    'entropy-phase', 'entropy-trust',
    'trust-phase'
  ];
  for (let a = 0; a < _ALL_AXES.length; a++) {
    const axis = _ALL_AXES[a];
    _axisToPairs[axis] = [];
    for (let p = 0; p < _ALL_PAIRS.length; p++) {
      if (_ALL_PAIRS[p].indexOf(axis) !== -1) {
        _axisToPairs[axis].push(_ALL_PAIRS[p]);
      }
    }
  }

  /**
   * Main per-measure update. Reads axis energy distribution, computes
   * equilibration pressure, and adjusts pair baselines via
   * pipelineCouplingManager.setPairBaseline().
   */
  function refresh() {
    _beatCount++;

    // Decrement cooldowns
    const cdKeys = Object.keys(_pairCooldowns);
    for (let i = 0; i < cdKeys.length; i++) {
      if (_pairCooldowns[cdKeys[i]] > 0) _pairCooldowns[cdKeys[i]]--;
    }

    // Read current axis energy shares
    const energyData = pipelineCouplingManager.getAxisEnergyShare();
    if (!energyData || !energyData.shares) return;

    const shares = energyData.shares;
    const axisGini = energyData.axisGini;

    // Update smoothed shares via EMA
    for (let a = 0; a < _ALL_AXES.length; a++) {
      const axis = _ALL_AXES[a];
      const raw = typeof shares[axis] === 'number' ? shares[axis] : 0;
      if (_smoothedShares[axis] === undefined) {
        _smoothedShares[axis] = raw;
      } else {
        _smoothedShares[axis] = _smoothedShares[axis] * (1 - _SHARE_EMA_ALPHA) + raw * _SHARE_EMA_ALPHA;
      }
    }

    // Skip adjustment during early warm-up (need stable EMAs)
    if (_beatCount < 20) return;

    // Gini escalation: when concentration is severe, increase adjustment rates
    const safeGini = V.optionalFinite(axisGini, 0);
    const giniMultiplier = (safeGini > _GINI_ESCALATION_THRESHOLD)
      ? _GINI_ESCALATION_MULTIPLIER
      : 1.0;

    // Read current baselines for diagnostic snapshot
    _lastBaselines = pipelineCouplingManager.getPairBaselines();

    // For each axis, determine if it's overloaded or suppressed
    for (let a = 0; a < _ALL_AXES.length; a++) {
      const axis = _ALL_AXES[a];
      const share = _smoothedShares[axis] || 0;

      if (share > _OVERSHOOT_THRESHOLD) {
        // Axis overloaded -- tighten pair baselines on this axis
        const excess = share - _FAIR_SHARE;
        const rate = _TIGHTEN_RATE * giniMultiplier * clamp(excess / _FAIR_SHARE, 0.5, 2.0);
        const pairs = _axisToPairs[axis];
        for (let p = 0; p < pairs.length; p++) {
          const pair = pairs[p];
          if ((_pairCooldowns[pair] || 0) > 0) continue;
          const currentBaseline = V.optionalFinite(_lastBaselines[pair]);
          if (currentBaseline === undefined) continue;
          const newBaseline = m.max(_BASELINE_MIN, currentBaseline - rate);
          if (newBaseline < currentBaseline) {
            pipelineCouplingManager.setPairBaseline(pair, newBaseline);
            _pairCooldowns[pair] = _COOLDOWN_BEATS;
            _adjustmentCount++;
            _axisAdjustments[axis] = (_axisAdjustments[axis] || 0) + 1;
          }
        }
      } else if (share < _UNDERSHOOT_THRESHOLD && share > 0.001) {
        // Axis suppressed -- relax pair baselines on this axis
        const deficit = _FAIR_SHARE - share;
        const rate = _RELAX_RATE * clamp(deficit / _FAIR_SHARE, 0.5, 2.0);
        const pairs = _axisToPairs[axis];
        for (let p = 0; p < pairs.length; p++) {
          const pair = pairs[p];
          if ((_pairCooldowns[pair] || 0) > 0) continue;
          const currentBaseline = V.optionalFinite(_lastBaselines[pair]);
          if (currentBaseline === undefined) continue;
          const newBaseline = m.min(_BASELINE_MAX, currentBaseline + rate);
          if (newBaseline > currentBaseline) {
            pipelineCouplingManager.setPairBaseline(pair, newBaseline);
            _pairCooldowns[pair] = _COOLDOWN_BEATS;
            _adjustmentCount++;
            _axisAdjustments[axis] = (_axisAdjustments[axis] || 0) + 1;
          }
        }
      }
    }

    // Diagnostics
    explainabilityBus.emit('AXIS_ENERGY_EQUIL', 'all', {
      smoothedShares: Object.assign({}, _smoothedShares),
      axisGini,
      giniMultiplier,
      adjustmentCount: _adjustmentCount,
      beatCount: _beatCount
    });
  }

  /**
   * Diagnostic snapshot for trace and post-run analysis.
   * @returns {{ beatCount: number, adjustmentCount: number, smoothedShares: Record<string, number>, axisAdjustments: Record<string, number>, lastBaselines: Record<string, number> }}
   */
  function getSnapshot() {
    return {
      beatCount: _beatCount,
      adjustmentCount: _adjustmentCount,
      smoothedShares: Object.assign({}, _smoothedShares),
      axisAdjustments: Object.assign({}, _axisAdjustments),
      lastBaselines: Object.assign({}, _lastBaselines)
    };
  }

  function reset() {
    // Dampen smoothed shares across sections (preserve 70% of structural knowledge)
    for (let a = 0; a < _ALL_AXES.length; a++) {
      const axis = _ALL_AXES[a];
      if (_smoothedShares[axis] !== undefined) {
        _smoothedShares[axis] = _smoothedShares[axis] * 0.7 + _FAIR_SHARE * 0.3;
      }
    }
    // Reset cooldowns per section
    const cdKeys = Object.keys(_pairCooldowns);
    for (let i = 0; i < cdKeys.length; i++) {
      _pairCooldowns[cdKeys[i]] = 0;
    }
    // Do NOT reset adjustment counts (run-level diagnostic)
  }

  // --- Self-registration ---
  conductorIntelligence.registerRecorder('axisEnergyEquilibrator', refresh);
  conductorIntelligence.registerStateProvider('axisEnergyEquilibrator', () => ({
    axisEnergyEquilibrator: getSnapshot()
  }));
  conductorIntelligence.registerModule('axisEnergyEquilibrator', { reset }, ['section']);

  return { getSnapshot, reset };
})();
