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
 *  5. Self-derives energy budget from observed peak energy
 *
 * R20 overhaul: Fixed convergence failure from R20 run where governor processed
 * only 72/611 beats and never throttled. Key fixes:
 * - Removed safePreBoot wrapper (profiler boots before this module)
 * - Faster EMA convergence (0.10 alpha, ~10-beat horizon)
 * - Higher section dampening preservation (0.90)
 * - EMA-smoothed redistribution detection (not raw beat-to-beat delta)
 * - Budget derived from observed peak energy, not static baselines
 *
 * Registered as the 12th hypermeta self-calibrating controller.
 */

couplingHomeostasis = (() => {

  // All monitored dimension pairs (mirrors pipelineCouplingManager.ALL_MONITORED_DIMS)
  const ALL_DIMS = ['density', 'tension', 'flicker', 'entropy', 'trust', 'phase'];

  // --- Structural constants ---
  // R20 E1: Tripled alpha (0.03->0.10) for ~10-beat convergence.
  // Previous 0.03 (~33-beat) couldn't converge with only 72 usable beats across 5 sections.
  const _ENERGY_EMA_ALPHA = 0.10;
  // R20 E2: Matched to energy alpha for consistent responsiveness.
  const _REDISTRIBUTION_EMA_ALPHA = 0.10;
  const _GAIN_THROTTLE_RATE = 0.01;        // per-beat global multiplier reduction
  const _GAIN_RECOVERY_RATE = 0.02;        // per-beat recovery (2x throttle for quick bounce-back)
  const _GAIN_FLOOR = 0.20;               // never fully disable coupling management
  const _GINI_THRESHOLD = 0.40;            // concentration guard activates above this
  // R20 E3: Peak energy decay rate (0.999/beat ~ 1000-beat half-life).
  const _PEAK_DECAY = 0.999;
  const _BUDGET_PEAK_RATIO = 0.90;        // budget = 90% of observed peak

  // --- State ---
  let _totalEnergyEma = 0;
  let _prevTotalEnergy = 0;
  let _redistributionScore = 0;        // 0 = none, 1 = severe redistribution
  let _globalGainMultiplier = 1.0;     // applied to pipelineCouplingManager
  let _energyBudget = 3.5;            // initialized high; converges from peak observation
  let _peakEnergyEma = 0;             // R20 E3: trailing max of totalEnergyEma
  let _giniCoefficient = 0;
  let _beatCount = 0;
  // R20 E2: EMA-smoothed redistribution inputs (replace raw beat-to-beat delta).
  let _energyDeltaEma = 0;
  let _pairTurbulenceEma = 0;

  /** @type {Record<string, number>} */
  let _pairAbsR = {};
  /** @type {Record<string, number>} */
  let _prevPairAbsR = {};

  /**
   * Main per-beat refresh. Registered as conductorIntelligence recorder.
   * Runs AFTER pipelineCouplingManager.refresh() due to registration order.
   */
  function refresh() {
    // R20 E1: Direct call (no safePreBoot). systemDynamicsProfiler boots before
    // this module in signal/index.js, so the global is always available.
    const snap = systemDynamicsProfiler.getSnapshot();
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
        if (cv === null || cv === undefined || cv !== cv) continue;
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

    // --- 2. Self-derive energy budget from observed peak ---
    // R20 E3: Budget tracks observed peak energy with slow decay.
    // Previous approach (sum of target baselines * 1.3) produced an unreachable
    // ceiling of 3.471 when actual totalEnergyEma was only 1.976, so overBudget
    // never triggered. Peak-tracking creates a tightening-only budget.
    _peakEnergyEma = m.max(_totalEnergyEma, _peakEnergyEma * _PEAK_DECAY);
    if (_beatCount >= 8 && _peakEnergyEma > 0.1) {
      _energyBudget = _peakEnergyEma * _BUDGET_PEAK_RATIO;
    }

    // --- 3. Detect redistribution ---
    // R20 E2: EMA-smoothed detection. Raw beat-to-beat delta is too noisy
    // (matrix recomputed from rolling window each beat). Using smoothed
    // energy delta and smoothed pair turbulence catches the actual redistribution
    // signal through the noise.
    const energyDelta = totalEnergy - _prevTotalEnergy;
    _energyDeltaEma = _energyDeltaEma * (1 - _REDISTRIBUTION_EMA_ALPHA) + energyDelta * _REDISTRIBUTION_EMA_ALPHA;

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
    _pairTurbulenceEma = _pairTurbulenceEma * (1 - _REDISTRIBUTION_EMA_ALPHA) + pairTurbulence * _REDISTRIBUTION_EMA_ALPHA;

    // R20 E2: Redistribution = smoothed total energy stable (|delta| < 5%) while
    // smoothed pair turbulence is high (> 0.005). Thresholds widened from the
    // original <2%/>0.01 which never triggered because of beat-to-beat noise.
    const isRedistributing = _prevTotalEnergy > 0.1 &&
      m.abs(_energyDeltaEma) / _totalEnergyEma < 0.05 &&
      _pairTurbulenceEma > 0.005;
    const redistTarget = isRedistributing ? 1.0 : 0.0;
    _redistributionScore = _redistributionScore * (1 - _REDISTRIBUTION_EMA_ALPHA) + redistTarget * _REDISTRIBUTION_EMA_ALPHA;

    _prevTotalEnergy = totalEnergy;

    // --- 4. Global gain throttle ---
    // R20 E2: Lower trigger threshold from 0.30 to 0.15 for redistribution.
    const overBudget = _totalEnergyEma > _energyBudget;
    const energyDecreasing = _energyDeltaEma < -0.005;

    if (_redistributionScore > 0.15 || overBudget) {
      _globalGainMultiplier = m.max(_GAIN_FLOOR, _globalGainMultiplier - _GAIN_THROTTLE_RATE);
    } else if (energyDecreasing || _totalEnergyEma < _energyBudget * 0.80) {
      _globalGainMultiplier = m.min(1.0, _globalGainMultiplier + _GAIN_RECOVERY_RATE);
    }

    // --- 5. Coupling concentration guard (Gini coefficient) ---
    const pairKeys = Object.keys(_pairAbsR);
    if (pairKeys.length > 4) {
      const values = [];
      for (let i = 0; i < pairKeys.length; i++) values.push(_pairAbsR[pairKeys[i]]);
      values.sort((a, b) => a - b);
      const n = values.length;
      const meanVal = totalEnergy / n;

      if (meanVal > 0.001) {
        let rankSum = 0;
        for (let i = 0; i < n; i++) {
          rankSum += (i + 1) * values[i];
        }
        _giniCoefficient = (2 * rankSum) / (n * totalEnergy) - (n + 1) / n;
        _giniCoefficient = clamp(_giniCoefficient, 0, 1);

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
      peak: Number(_peakEnergyEma.toFixed(3)),
      redistribution: Number(_redistributionScore.toFixed(3)),
      multiplier: Number(_globalGainMultiplier.toFixed(3)),
      gini: Number(_giniCoefficient.toFixed(3)),
      energyDeltaEma: Number(_energyDeltaEma.toFixed(4)),
      pairTurbulenceEma: Number(_pairTurbulenceEma.toFixed(4)),
      overBudget,
      pairs: pairCount
    });
  }

  /**
   * Diagnostic snapshot for trace pipeline.
   * @returns {{ totalEnergyEma: number, energyBudget: number, peakEnergyEma: number, redistributionScore: number, globalGainMultiplier: number, giniCoefficient: number, energyDeltaEma: number, pairTurbulenceEma: number, beatCount: number }}
   */
  function getState() {
    return {
      totalEnergyEma: Number(_totalEnergyEma.toFixed(4)),
      energyBudget: Number(_energyBudget.toFixed(4)),
      peakEnergyEma: Number(_peakEnergyEma.toFixed(4)),
      redistributionScore: Number(_redistributionScore.toFixed(4)),
      globalGainMultiplier: Number(_globalGainMultiplier.toFixed(4)),
      giniCoefficient: Number(_giniCoefficient.toFixed(4)),
      energyDeltaEma: Number(_energyDeltaEma.toFixed(4)),
      pairTurbulenceEma: Number(_pairTurbulenceEma.toFixed(4)),
      beatCount: _beatCount
    };
  }

  /**
   * Section reset: dampen rather than wipe. Preserves cross-section energy learning.
   * R20 E1: Raised dampening from 0.70 to 0.90 to preserve 66% signal after
   * 5 sections (was 17% at 0.70). Peak tracked separately with slow decay.
   */
  function reset() {
    _totalEnergyEma *= 0.90;
    _prevTotalEnergy *= 0.90;
    _redistributionScore *= 0.50;
    _energyDeltaEma *= 0.50;
    _pairTurbulenceEma *= 0.50;
    // Partial recovery toward 1.0 on section reset
    _globalGainMultiplier = _globalGainMultiplier * 0.5 + 0.5;
    // Peak preserved fully -- only decays via _PEAK_DECAY per beat
    _pairAbsR = {};
    _prevPairAbsR = {};
    // _beatCount intentionally NOT reset: tracks lifetime beats for budget recalibration
  }

  // --- Self-registration ---
  conductorIntelligence.registerRecorder('couplingHomeostasis', refresh);
  conductorIntelligence.registerModule('couplingHomeostasis', { reset }, ['section']);

  return { getState, reset };
})();
