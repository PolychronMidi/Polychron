// @ts-check

/**
 * Coupling Homeostasis Governor (Hypermeta #12)
 *
 * Root cause of the eternal whack-a-mole: per-pair decorrelation is structurally
 * incapable of reducing TOTAL system coupling because correlation energy is
 * approximately conserved in coupled dynamical systems. Decorrelating pair A on
 * axis X causes pairs B,C on axis X (and cross-axis pairs) to absorb the energy.
 * R12-R19 proved this empirically across 8 generations.
 *
 * This governor operates ABOVE all per-pair and per-axis mechanisms:
 *  1. Tracks total coupling energy (sum |r| across all pairs) as a single scalar
 *  2. Detects redistribution: total stable while pair-level turbulence is high
 *  3. Global gain throttle: when redistribution running, reduces all gains
 *  4. Concentration guard (Gini coefficient): penalizes concentrated energy
 *  5. Self-derives energy budget from adaptive target baselines
 *
 * Registered as the 12th hypermeta self-calibrating controller.
 */

couplingHomeostasis = (() => {

  // All monitored dimension pairs (mirrors pipelineCouplingManager.ALL_MONITORED_DIMS)
  const ALL_DIMS = ['density', 'tension', 'flicker', 'entropy', 'trust', 'phase'];

  // --- Structural constants (self-calibrating, should NOT need manual tuning) ---
  const _ENERGY_EMA_ALPHA = 0.03;          // ~33-beat horizon for total energy
  const _REDISTRIBUTION_EMA_ALPHA = 0.05;  // ~20-beat horizon for turbulence detection
  const _GAIN_THROTTLE_RATE = 0.01;        // per-beat global multiplier reduction
  const _GAIN_RECOVERY_RATE = 0.02;        // per-beat recovery (2x throttle for quick bounce-back)
  const _GAIN_FLOOR = 0.20;               // never fully disable coupling management
  const _GINI_THRESHOLD = 0.40;            // concentration guard activates above this
  const _BUDGET_RECALIBRATE_INTERVAL = 32; // beats between budget recalculation
  const _BUDGET_HEADROOM = 1.3;            // allow 30% above ideal aggregate |r|

  // --- State ---
  let _totalEnergyEma = 0;
  let _prevTotalEnergy = 0;
  let _redistributionScore = 0;        // 0 = none, 1 = severe redistribution
  let _globalGainMultiplier = 1.0;     // applied to pipelineCouplingManager
  let _energyBudget = 3.5;            // self-derived, initialized to reasonable default
  let _giniCoefficient = 0;
  let _beatCount = 0;

  /** @type {Record<string, number>} */
  let _pairAbsR = {};
  /** @type {Record<string, number>} */
  let _prevPairAbsR = {};

  /**
   * Main per-beat refresh. Registered as conductorIntelligence recorder.
   * Runs AFTER pipelineCouplingManager.refresh() due to registration order.
   */
  function refresh() {
    const snap = safePreBoot.call(() => systemDynamicsProfiler.getSnapshot(), null);
    if (!snap || !snap.couplingMatrix) return;

    const matrix = snap.couplingMatrix;
    _beatCount++;

    // --- 1. Compute total coupling energy ---
    _prevPairAbsR = _pairAbsR;
    _pairAbsR = {};
    let totalEnergy = 0;
    let pairCount = 0;

    for (let a = 0; a < ALL_DIMS.length; a++) {
      for (let b = a + 1; b < ALL_DIMS.length; b++) {
        const k = ALL_DIMS[a] + '-' + ALL_DIMS[b];
        const cv = matrix[k];
        if (cv === null || cv === undefined || cv !== cv) continue; // null, undefined, NaN
        const ac = m.abs(cv);
        _pairAbsR[k] = ac;
        totalEnergy += ac;
        pairCount++;
      }
    }

    if (pairCount === 0) return;

    // Update total energy EMA
    if (_beatCount <= 2) {
      _totalEnergyEma = totalEnergy;
    } else {
      _totalEnergyEma = _totalEnergyEma * (1 - _ENERGY_EMA_ALPHA) + totalEnergy * _ENERGY_EMA_ALPHA;
    }

    // --- 2. Self-derive energy budget from adaptive target baselines ---
    // Budget = sum(all pair baselines) * headroom. As targets tighten, budget auto-tightens.
    if (_beatCount % _BUDGET_RECALIBRATE_INTERVAL === 0) {
      const targetSnap = pipelineCouplingManager.getAdaptiveTargetSnapshot();
      if (targetSnap) {
        let baselineSum = 0;
        const tKeys = Object.keys(targetSnap);
        for (let i = 0; i < tKeys.length; i++) {
          baselineSum += targetSnap[tKeys[i]].baseline;
        }
        if (baselineSum > 0.1) {
          _energyBudget = baselineSum * _BUDGET_HEADROOM;
        }
      }
    }

    // --- 3. Detect redistribution ---
    // Redistribution = total energy stable (< 2% change) while pair-level turbulence high.
    // This is the signature of the balloon effect: squeezing one pair inflates another.
    const energyDelta = totalEnergy - _prevTotalEnergy;
    const energyDeltaPct = _prevTotalEnergy > 0 ? m.abs(energyDelta) / _prevTotalEnergy : 0;

    let pairTurbulence = 0;
    const prevKeys = Object.keys(_prevPairAbsR);
    if (prevKeys.length > 0) {
      let turbSum = 0;
      for (let i = 0; i < prevKeys.length; i++) {
        const curr = _pairAbsR[prevKeys[i]] || 0;
        const prev = _prevPairAbsR[prevKeys[i]] || 0;
        turbSum += m.abs(curr - prev);
      }
      pairTurbulence = turbSum / prevKeys.length;
    }

    const isRedistributing = energyDeltaPct < 0.02 && pairTurbulence > 0.01;
    const redistTarget = isRedistributing ? 1.0 : 0.0;
    _redistributionScore = _redistributionScore * (1 - _REDISTRIBUTION_EMA_ALPHA) + redistTarget * _REDISTRIBUTION_EMA_ALPHA;

    _prevTotalEnergy = totalEnergy;

    // --- 4. Global gain throttle ---
    // When redistribution is high or total exceeds budget: throttle.
    // When total is decreasing or well under budget: recover.
    const overBudget = _totalEnergyEma > _energyBudget;
    const energyDecreasing = energyDelta < -0.01;

    if (_redistributionScore > 0.30 || overBudget) {
      // Throttle: gains are being wasted on redistribution or budget exceeded
      _globalGainMultiplier = m.max(_GAIN_FLOOR, _globalGainMultiplier - _GAIN_THROTTLE_RATE);
    } else if (energyDecreasing || _totalEnergyEma < _energyBudget * 0.80) {
      // Recovery: actual decorrelation working or energy well under budget
      _globalGainMultiplier = m.min(1.0, _globalGainMultiplier + _GAIN_RECOVERY_RATE);
    }

    // --- 5. Coupling concentration guard (Gini coefficient) ---
    // When coupling energy concentrates in a few pairs (high Gini), the concentrated
    // pairs absorb all decorrelation budget while low-coupling pairs waste none.
    // Extra throttle promotes more uniform distribution.
    const pairKeys = Object.keys(_pairAbsR);
    if (pairKeys.length > 4) {
      const values = [];
      for (let i = 0; i < pairKeys.length; i++) values.push(_pairAbsR[pairKeys[i]]);
      values.sort((a, b) => a - b);
      const n = values.length;
      const meanVal = totalEnergy / n;

      // Gini via sorted-rank formula: G = (2 * sum(i * x_i)) / (n * sum(x_i)) - (n+1)/n
      if (meanVal > 0.001) {
        let rankSum = 0;
        for (let i = 0; i < n; i++) {
          rankSum += (i + 1) * values[i];
        }
        _giniCoefficient = (2 * rankSum) / (n * totalEnergy) - (n + 1) / n;
        _giniCoefficient = clamp(_giniCoefficient, 0, 1);

        // When Gini exceeds threshold, apply additional throttle
        if (_giniCoefficient > _GINI_THRESHOLD) {
          const extraThrottle = clamp((_giniCoefficient - _GINI_THRESHOLD) * 0.5, 0, 0.10);
          _globalGainMultiplier = m.max(_GAIN_FLOOR, _globalGainMultiplier - extraThrottle);
        }
      }
    }

    // Apply final multiplier to pipelineCouplingManager
    pipelineCouplingManager.setGlobalGainMultiplier(_globalGainMultiplier);

    // --- Diagnostics ---
    explainabilityBus.emit('COUPLING_HOMEOSTASIS', 'both', {
      totalEnergy: Number(totalEnergy.toFixed(3)),
      ema: Number(_totalEnergyEma.toFixed(3)),
      budget: Number(_energyBudget.toFixed(3)),
      redistribution: Number(_redistributionScore.toFixed(3)),
      multiplier: Number(_globalGainMultiplier.toFixed(3)),
      gini: Number(_giniCoefficient.toFixed(3)),
      overBudget,
      pairs: pairCount
    });
  }

  /**
   * Diagnostic snapshot for trace pipeline.
   * @returns {{ totalEnergyEma: number, energyBudget: number, redistributionScore: number, globalGainMultiplier: number, giniCoefficient: number, beatCount: number }}
   */
  function getState() {
    return {
      totalEnergyEma: Number(_totalEnergyEma.toFixed(4)),
      energyBudget: Number(_energyBudget.toFixed(4)),
      redistributionScore: Number(_redistributionScore.toFixed(4)),
      globalGainMultiplier: Number(_globalGainMultiplier.toFixed(4)),
      giniCoefficient: Number(_giniCoefficient.toFixed(4)),
      beatCount: _beatCount
    };
  }

  /**
   * Section reset: dampen rather than wipe. Preserves cross-section energy learning.
   */
  function reset() {
    _totalEnergyEma *= 0.7;
    _prevTotalEnergy *= 0.7;
    _redistributionScore *= 0.3;
    // Partial recovery toward 1.0 on section reset
    _globalGainMultiplier = _globalGainMultiplier * 0.5 + 0.5;
    _pairAbsR = {};
    _prevPairAbsR = {};
    // _beatCount intentionally NOT reset: tracks lifetime beats for budget recalibration
  }

  // --- Self-registration ---
  conductorIntelligence.registerRecorder('couplingHomeostasis', refresh);
  conductorIntelligence.registerModule('couplingHomeostasis', { reset }, ['section']);

  return { getState, reset };
})();
