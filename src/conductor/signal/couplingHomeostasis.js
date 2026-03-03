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
 * R21 overhaul: Fixed three critical issues from R21 run:
 * - beatCount=60/414 (14.5%): Added matrix caching + invoke tracking (E1/E6)
 * - Permanent throttle lock (multiplier=0.386): Recovery floor + redistribution
 *   cooldown prevent ratchet-to-floor (E2). Proportional throttle scales with
 *   over-budget severity (E5).
 * - Redistribution always true: Raised turbulence threshold 0.005->0.02 (E2)
 *
 * Registered as the 12th hypermeta self-calibrating controller.
 */

couplingHomeostasis = (() => {

  // All monitored dimension pairs (mirrors pipelineCouplingManager.ALL_MONITORED_DIMS)
  const ALL_DIMS = ['density', 'tension', 'flicker', 'entropy', 'trust', 'phase'];

  // --- Structural constants ---
  // R20 E1: Tripled alpha (0.03->0.10) for ~10-beat convergence.
  const _ENERGY_EMA_ALPHA = 0.10;
  // R20 E2: Matched to energy alpha for consistent responsiveness.
  const _REDISTRIBUTION_EMA_ALPHA = 0.10;
  // R21 E5: Proportional throttle base + ceiling (replaces fixed 0.01).
  const _THROTTLE_BASE = 0.005;             // minimum throttle per beat
  const _THROTTLE_PROPORTIONAL = 0.02;      // additional throttle at 100%+ over-budget
  const _GAIN_RECOVERY_RATE = 0.02;         // per-beat recovery (2x base throttle)
  // R21 E2: Unconditional minimum recovery prevents permanent throttle lock.
  const _MINIMUM_RECOVERY_RATE = 0.003;     // always applied, even during throttle
  const _GAIN_FLOOR = 0.20;                 // never fully disable coupling management
  const _GINI_THRESHOLD = 0.40;             // concentration guard activates above this
  // R20 E3: Peak energy decay rate (0.999/beat ~ 1000-beat half-life).
  const _PEAK_DECAY = 0.999;
  const _BUDGET_PEAK_RATIO = 0.90;          // budget = 90% of observed peak
  // R21 E2: Redistribution turbulence threshold (raised from 0.005).
  // Normal rolling-window noise produces turbulence ~0.01-0.015; only genuine
  // redistribution (pair-level shuffling while total stable) exceeds 0.02.
  const _REDIST_TURBULENCE_THRESHOLD = 0.02;
  // R21 E2: Redistribution cooldown -- consecutive non-redistributing beats
  // before accelerated score decay kicks in.
  const _REDIST_COOLDOWN_BEATS = 20;
  const _REDIST_COOLDOWN_DECAY = 0.95;      // per-beat decay during cooldown

  // --- State ---
  let _totalEnergyEma = 0;
  let _prevTotalEnergy = 0;
  let _redistributionScore = 0;        // 0 = none, 1 = severe redistribution
  let _globalGainMultiplier = 1.0;     // applied to pipelineCouplingManager
  let _energyBudget = 3.5;            // initialized high; converges from peak observation
  let _peakEnergyEma = 0;             // R20 E3: trailing max of totalEnergyEma
  let _giniCoefficient = 0;
  let _beatCount = 0;                 // beats with valid coupling data
  // R20 E2: EMA-smoothed redistribution inputs (replace raw beat-to-beat delta).
  let _energyDeltaEma = 0;
  let _pairTurbulenceEma = 0;
  // R21 E1: Matrix caching - use last valid matrix when profiler returns empty
  /** @type {Record<string, number>} */
  let _cachedMatrix = {};
  let _cachedMatrixAge = 0;           // beats since last real matrix update (stale count)
  // R21 E2: Redistribution cooldown tracker
  let _nonRedistBeats = 0;
  // R21 E6: Invoke tracking for beat processing diagnostics
  let _invokeCount = 0;               // every refresh() call regardless of guards
  let _emptyMatrixBeats = 0;          // beats where profiler returned empty matrix
  let _multiplierMin = 1.0;
  let _multiplierMax = 0.0;

  /** @type {Record<string, number>} */
  let _pairAbsR = {};
  /** @type {Record<string, number>} */
  let _prevPairAbsR = {};

  /**
   * Main per-beat refresh. Registered as conductorIntelligence recorder.
   * Runs AFTER pipelineCouplingManager.refresh() due to registration order.
   */
  function refresh() {
    // R21 E6: Track every invocation for diagnostics
    _invokeCount++;

    // R20 E1: Direct call (no safePreBoot). systemDynamicsProfiler boots before
    // this module in signal/index.js, so the global is always available.
    const snap = systemDynamicsProfiler.getSnapshot();
    if (!snap || !snap.couplingMatrix) {
      throw new Error('couplingHomeostasis: systemDynamicsProfiler snapshot unavailable');
    }

    // R21 E1: Matrix caching -- check if profiler has real data or empty {}
    const rawMatrix = snap.couplingMatrix;
    let matrix = rawMatrix;
    let hasRealData = false;
    const rawKeys = Object.keys(rawMatrix);
    if (rawKeys.length > 0) {
      // Profiler has real coupling data -- update cache
      _cachedMatrix = rawMatrix;
      _cachedMatrixAge = 0;
      hasRealData = true;
    } else {
      // Empty matrix (section warm-up). Fall back to cached matrix with age decay.
      _emptyMatrixBeats++;
      _cachedMatrixAge++;
      if (Object.keys(_cachedMatrix).length > 0 && _cachedMatrixAge <= 12) {
        matrix = _cachedMatrix;
        // Note: using stale data -- energy values will be decayed below
      } else {
        // No cached data yet (very start of run) -- skip energy processing.
        // Multiplier stays at initial 1.0 until first real matrix arrives.
        explainabilityBus.emit('COUPLING_HOMEOSTASIS', 'both', {
          skipped: true, reason: 'no-cached-matrix', invokeCount: _invokeCount
        });
        return;
      }
    }

    _beatCount++;

    // --- 1. Compute total coupling energy ---
    _prevPairAbsR = _pairAbsR;
    _pairAbsR = {};
    let totalEnergy = 0;
    let pairCount = 0;
    // R21 E1: Stale decay factor -- reduces cached values to avoid false readings
    const staleFactor = hasRealData ? 1.0 : m.pow(0.95, _cachedMatrixAge);

    for (let a = 0; a < ALL_DIMS.length; a++) {
      for (let b = a + 1; b < ALL_DIMS.length; b++) {
        const k = ALL_DIMS[a] + '-' + ALL_DIMS[b];
        const cv = matrix[k];
        if (cv === null || cv === undefined || cv !== cv) continue;
        const ac = m.abs(cv) * staleFactor;
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
    _peakEnergyEma = m.max(_totalEnergyEma, _peakEnergyEma * _PEAK_DECAY);
    if (_beatCount >= 8 && _peakEnergyEma > 0.1) {
      _energyBudget = _peakEnergyEma * _BUDGET_PEAK_RATIO;
    }

    // --- 3. Detect redistribution ---
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

    // R21 E2: Raised turbulence threshold 0.005->0.02. Normal rolling-window
    // noise was always above 0.005, causing permanent redistribution detection.
    const isRedistributing = _prevTotalEnergy > 0.1 &&
      m.abs(_energyDeltaEma) / _totalEnergyEma < 0.05 &&
      _pairTurbulenceEma > _REDIST_TURBULENCE_THRESHOLD;
    const redistTarget = isRedistributing ? 1.0 : 0.0;
    _redistributionScore = _redistributionScore * (1 - _REDISTRIBUTION_EMA_ALPHA) + redistTarget * _REDISTRIBUTION_EMA_ALPHA;

    // R21 E2: Accelerated redistribution cooldown. When not redistributing for
    // _REDIST_COOLDOWN_BEATS consecutive beats, apply faster decay to break
    // the score out of the 0.959 permanent-lock observed in R21.
    if (!isRedistributing) {
      _nonRedistBeats++;
      if (_nonRedistBeats > _REDIST_COOLDOWN_BEATS) {
        _redistributionScore *= _REDIST_COOLDOWN_DECAY;
      }
    } else {
      _nonRedistBeats = 0;
    }

    _prevTotalEnergy = totalEnergy;

    // --- 4. Global gain throttle ---
    const overBudget = _totalEnergyEma > _energyBudget;
    const energyDecreasing = _energyDeltaEma < -0.005;

    if (_redistributionScore > 0.15 || overBudget) {
      // R21 E5: Proportional throttle -- rate scales with over-budget severity.
      // At budget edge: 0.005/beat. At 2x budget: 0.025/beat.
      const overBudgetRatio = overBudget
        ? clamp((_totalEnergyEma - _energyBudget) / _energyBudget, 0, 1)
        : 0;
      const throttleRate = _THROTTLE_BASE + overBudgetRatio * _THROTTLE_PROPORTIONAL;
      _globalGainMultiplier = m.max(_GAIN_FLOOR, _globalGainMultiplier - throttleRate);
      // R21 E2: Minimum recovery even during throttle -- prevents ratchet-to-floor.
      _globalGainMultiplier = m.min(1.0, _globalGainMultiplier + _MINIMUM_RECOVERY_RATE);
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

    // R21 E6: Track multiplier extremes
    _multiplierMin = m.min(_multiplierMin, _globalGainMultiplier);
    _multiplierMax = m.max(_multiplierMax, _globalGainMultiplier);

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
   * R21 E6: Extended with invoke tracking, multiplier range, and matrix diagnostics.
   * @returns {{ totalEnergyEma: number, energyBudget: number, peakEnergyEma: number, redistributionScore: number, globalGainMultiplier: number, giniCoefficient: number, energyDeltaEma: number, pairTurbulenceEma: number, beatCount: number, invokeCount: number, emptyMatrixBeats: number, multiplierMin: number, multiplierMax: number }}
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
      beatCount: _beatCount,
      invokeCount: _invokeCount,
      emptyMatrixBeats: _emptyMatrixBeats,
      multiplierMin: Number(_multiplierMin.toFixed(4)),
      multiplierMax: Number(_multiplierMax.toFixed(4))
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
    // R21 E2: Reset cooldown on section boundary
    _nonRedistBeats = 0;
    // R21 E1: Cached matrix preserved across sections (stale decay handles aging)
    // _beatCount intentionally NOT reset: tracks lifetime beats for budget recalibration
    // _invokeCount intentionally NOT reset: tracks total lifetime invocations
  }

  // --- Self-registration ---
  conductorIntelligence.registerRecorder('couplingHomeostasis', refresh);
  conductorIntelligence.registerModule('couplingHomeostasis', { reset }, ['section']);

  return { getState, reset };
})();
