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
 * Architecture: Two-speed update.
 *  - refresh() is called from the recorder pipeline (~once per measure).
 *    This is where coupling data is analysed: energy EMAs, redistribution
 *    detection, Gini coefficient, and budget self-derivation.
 *  - tick() is called from processBeat (once per beat-layer entry, ~418/run).
 *    This is where the multiplier is adjusted: throttle, recovery, floor,
 *    and time-series recording. Smooth per-beat resolution prevents the
 *    multiplier from being stuck for 5+ beats between measure boundaries.
 *
 * R22 evolution summary:
 * - E1: Per-beat tick() for multiplier management (separate from per-measure
 *   coupling analysis in refresh()). invokeCount was 78/418 because recorders
 *   fire once per measure via layerPass.js caching.
 * - E2: Budget convergence fix -- peak decay 0.999->0.995, peak capped at
 *   1.5x totalEnergyEma to prevent runaway budget from early volatility.
 * - E3: Relative redistribution turbulence threshold -- turbulence/totalEnergy
 *   instead of absolute threshold. Scale-invariant detection.
 * - E6: Multiplier time-series trace for throttle behavior analysis.
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
  // R22 E2: Faster peak decay (0.999->0.995, ~200-beat half-life).
  // At 78 invocations/run: 0.995^78 = 0.676 (32% decay vs 7.5% at 0.999).
  const _PEAK_DECAY = 0.995;
  const _BUDGET_PEAK_RATIO = 0.90;          // budget = 90% of observed peak
  // R22 E2: Cap peak at 1.5x current EMA to prevent runaway from early volatility.
  const _PEAK_EMA_CAP_RATIO = 1.5;
  // R22 E3: Relative redistribution turbulence threshold (replaces absolute 0.02).
  // Turbulence is normalized by total energy for scale-invariant detection.
  // At totalEnergy=3.8, threshold 0.012 = effective absolute 0.046.
  const _REDIST_RELATIVE_THRESHOLD = 0.012;
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
  let _beatCount = 0;                 // beats with valid coupling data (measure-level)
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
  // R22 E1: Per-beat tick counter (tracks tick() calls from processBeat)
  let _tickCount = 0;
  // R22 E1: Flag to skip redundant multiplier update when refresh() already ran
  let _refreshedThisTick = false;
  // R22 E1: Cached throttle state from refresh() for use in tick()
  let _overBudget = false;
  let _energyDecreasing = false;
  // R22 E6: Multiplier time-series for throttle behavior analysis
  /** @type {{ beat: number, m: number, e: number, r: number }[]} */
  const _multiplierTimeSeries = [];
  const _MAX_TIME_SERIES = 2000;

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
    // R22 E2: Cap peak at 1.5x current EMA to prevent runaway from early volatility.
    // In R22, peakEnergyEma=6.015 while totalEnergyEma=3.784 (59% gap). This cap
    // ensures budget tracks actual energy within 50% even during section transitions.
    if (_totalEnergyEma > 0.1) {
      _peakEnergyEma = m.min(_peakEnergyEma, _totalEnergyEma * _PEAK_EMA_CAP_RATIO);
    }
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

    // R22 E3: Relative turbulence threshold (replaces absolute 0.02).
    // Turbulence normalized by total energy is scale-invariant. In R22,
    // pairTurbulenceEma=0.035 and totalEnergyEma=3.784 -> relative=0.0092.
    // At absolute threshold 0.02, this was always triggered. At relative
    // threshold 0.012, it correctly identifies genuine redistribution events.
    const relativeTurbulence = _totalEnergyEma > 0.1
      ? _pairTurbulenceEma / _totalEnergyEma
      : 0;
    const isRedistributing = _prevTotalEnergy > 0.1 &&
      m.abs(_energyDeltaEma) / _totalEnergyEma < 0.05 &&
      relativeTurbulence > _REDIST_RELATIVE_THRESHOLD;
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

    // --- 4. Cache throttle state for tick() ---
    // R22 E1: Multiplier management moved to tick() for per-beat resolution.
    // refresh() only updates the coupling analysis state; tick() reads
    // _overBudget/_energyDecreasing and applies multiplier changes.
    _overBudget = _totalEnergyEma > _energyBudget;
    _energyDecreasing = _energyDeltaEma < -0.005;

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
      }
    }

    // R22 E1: Mark that refresh ran on this tick so tick() skips redundant update
    _refreshedThisTick = true;

    // Run tick() to apply multiplier changes (will use freshly computed state)
    tick();

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
      overBudget: _overBudget,
      pairs: pairCount
    });
  }

  /**
   * Per-beat multiplier management. Called from processBeat's post-beat stage
   * on every beat-layer entry (~418/run). Provides smoother multiplier evolution
   * than the measure-only recorder invocation (~78/run).
   *
   * R22 E1: Separates multiplier management (per-beat) from coupling analysis
   * (per-measure). The coupling data only updates when the recorder fires, but
   * the multiplier adjusts every beat for responsive energy governance.
   */
  function tick() {
    _tickCount++;

    // If refresh() already ran on this tick's recorder invocation, skip the
    // multiplier update here (refresh -> tick already called above).
    if (_refreshedThisTick) {
      _refreshedThisTick = false;
      // Multiplier was already applied inside this refresh -> tick() path.
      // Fall through to time-series recording below.
    } else {
      // --- Multiplier throttle / recovery ---
      if (_redistributionScore > 0.15 || _overBudget) {
        // R21 E5: Proportional throttle -- rate scales with over-budget severity.
        const overBudgetRatio = _overBudget
          ? clamp((_totalEnergyEma - _energyBudget) / _energyBudget, 0, 1)
          : 0;
        const throttleRate = _THROTTLE_BASE + overBudgetRatio * _THROTTLE_PROPORTIONAL;
        _globalGainMultiplier = m.max(_GAIN_FLOOR, _globalGainMultiplier - throttleRate);
        // R21 E2: Minimum recovery even during throttle
        _globalGainMultiplier = m.min(1.0, _globalGainMultiplier + _MINIMUM_RECOVERY_RATE);
      } else if (_energyDecreasing || _totalEnergyEma < _energyBudget * 0.80) {
        _globalGainMultiplier = m.min(1.0, _globalGainMultiplier + _GAIN_RECOVERY_RATE);
      }

      // Gini penalty (uses cached _giniCoefficient from last refresh)
      if (_giniCoefficient > _GINI_THRESHOLD) {
        const extraThrottle = clamp((_giniCoefficient - _GINI_THRESHOLD) * 0.5, 0, 0.10);
        _globalGainMultiplier = m.max(_GAIN_FLOOR, _globalGainMultiplier - extraThrottle);
      }
    }

    // Track multiplier extremes
    _multiplierMin = m.min(_multiplierMin, _globalGainMultiplier);
    _multiplierMax = m.max(_multiplierMax, _globalGainMultiplier);

    // Apply multiplier to pipelineCouplingManager
    pipelineCouplingManager.setGlobalGainMultiplier(_globalGainMultiplier);

    // R22 E6: Record time-series entry for throttle behavior analysis
    if (_multiplierTimeSeries.length < _MAX_TIME_SERIES) {
      _multiplierTimeSeries.push({
        beat: _tickCount,
        m: Number(_globalGainMultiplier.toFixed(3)),
        e: Number(_totalEnergyEma.toFixed(2)),
        r: Number(_redistributionScore.toFixed(2))
      });
    }
  }

  /**
   * Diagnostic snapshot for trace pipeline.
   * R22: Extended with tickCount, time-series derived metrics, and per-beat diagnostics.
   */
  function getState() {
    // R22 E6: Compute time-series derived metrics
    let floorContactBeats = 0;
    let ceilingContactBeats = 0;
    let multiplierSum = 0;
    let multiplierSqSum = 0;
    const tsLen = _multiplierTimeSeries.length;
    const recoveryDurations = [];
    let inFloorContact = false;
    let floorStart = 0;

    for (let i = 0; i < tsLen; i++) {
      const mv = _multiplierTimeSeries[i].m;
      multiplierSum += mv;
      multiplierSqSum += mv * mv;
      if (mv <= 0.21) {
        floorContactBeats++;
        if (!inFloorContact) { inFloorContact = true; floorStart = i; }
      } else if (mv >= 0.99) {
        ceilingContactBeats++;
      }
      if (inFloorContact && mv > 0.50) {
        recoveryDurations.push(i - floorStart);
        inFloorContact = false;
      }
    }

    const multiplierMean = tsLen > 0 ? multiplierSum / tsLen : 0;
    const multiplierVariance = tsLen > 1
      ? (multiplierSqSum / tsLen - multiplierMean * multiplierMean)
      : 0;
    const multiplierStdDev = m.sqrt(m.max(0, multiplierVariance));
    const avgRecoveryDuration = recoveryDurations.length > 0
      ? recoveryDurations.reduce((a, b) => a + b, 0) / recoveryDurations.length
      : 0;

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
      tickCount: _tickCount,
      emptyMatrixBeats: _emptyMatrixBeats,
      multiplierMin: Number(_multiplierMin.toFixed(4)),
      multiplierMax: Number(_multiplierMax.toFixed(4)),
      // R22 E6: Time-series derived metrics
      multiplierStdDev: Number(multiplierStdDev.toFixed(4)),
      floorContactBeats,
      ceilingContactBeats,
      avgRecoveryDuration: Number(avgRecoveryDuration.toFixed(1))
    };
  }

  /**
   * Section reset: dampen rather than wipe. Preserves cross-section energy learning.
   */
  function reset() {
    _totalEnergyEma *= 0.90;
    _prevTotalEnergy *= 0.90;
    _redistributionScore *= 0.50;
    _energyDeltaEma *= 0.50;
    _pairTurbulenceEma *= 0.50;
    // Partial recovery toward 1.0 on section reset
    _globalGainMultiplier = _globalGainMultiplier * 0.5 + 0.5;
    _pairAbsR = {};
    _prevPairAbsR = {};
    _nonRedistBeats = 0;
    // Cached matrix preserved across sections (stale decay handles aging)
    // _beatCount intentionally NOT reset: tracks lifetime beats for budget recalibration
    // _invokeCount/_tickCount intentionally NOT reset: tracks total lifetime invocations
  }

  // --- Self-registration ---
  conductorIntelligence.registerRecorder('couplingHomeostasis', refresh);
  conductorIntelligence.registerModule('couplingHomeostasis', { reset }, ['section']);

  return { getState, reset, tick };
})();
