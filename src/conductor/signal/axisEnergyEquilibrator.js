// @ts-check

/**
 * Axis Energy Equilibrator -- Hypermeta Self-Calibrating Controller #13
 *
 * Two-layer omnipotent coupling self-correction that permanently eliminates
 * whack-a-mole. Manual pair-target tuning is never needed again.
 *
 * LAYER 1 -- PAIR-LEVEL HOTSPOT DETECTION
 * Reads per-pair rollingAbsCorr from getAdaptiveTargetSnapshot(). When any
 * pair's measured coupling exceeds HOTSPOT_RATIO x its baseline, that pair
 * is tightened directly. When a pair is over-suppressed (< COLDSPOT_RATIO),
 * it relaxes. This catches within-axis redistribution that axis-level
 * balancing cannot see (e.g. density-tension surging +104% while both axes
 * are near fair-share).
 *
 * LAYER 2 -- AXIS-LEVEL ENERGY BALANCING
 * Monitors per-axis energy shares (getAxisEnergyShare). Nudges ALL pairs on
 * overloaded/suppressed axes. Fires after Layer 1 and skips pairs already
 * adjusted (via cooldown).
 *
 * Hypermeta controller #13: axisEnergyEquilibrator
 * Axes: density, tension, flicker, entropy, trust, phase
 * Interacts with: #1 (selfCalibratingCouplingTargets), #9 (gainBudget),
 *                 #12 (couplingHomeostasis)
 */

axisEnergyEquilibrator = (() => {
  const V = validator.create('axisEnergyEquilibrator');

  // -- Layer 1 config: pair-level hotspot detection --
  // R30: Uses rawRollingAbsCorr (unattenuated) instead of rollingAbsCorr
  // (regime-adjusted EMA). In R29, rolling was 60-70% attenuated vs actual
  // coupling, so density-flicker at 0.602 actual only showed 0.190 rolling.
  const _HOTSPOT_RATIO = 2.0;      // pair is hot when raw > 2.0x baseline
  const _HOTSPOT_ABS_MIN = 0.25;   // ignore unless raw crosses absolute floor
  const _COLDSPOT_RATIO = 0.3;     // pair is cold when raw < 0.3x baseline
  const _COLDSPOT_ABS_MAX = 0.10;  // only relax if raw is below this absolute cap
  const _PAIR_TIGHTEN_RATE = 0.004;
  const _PAIR_RELAX_RATE = 0.002;
  const _PAIR_COOLDOWN = 3;

  // -- Layer 2 config: axis-level energy balancing --
  const _FAIR_SHARE = 1.0 / 6.0;
  const _AXIS_OVERSHOOT = 0.22;    // share > 0.22 triggers tightening
  const _AXIS_UNDERSHOOT = 0.12;   // share < 0.12 triggers relaxation
  const _AXIS_TIGHTEN_RATE = 0.002;
  const _AXIS_RELAX_RATE = 0.0012;
  const _AXIS_COOLDOWN = 4;
  const _SHARE_EMA_ALPHA = 0.08;   // ~12-beat horizon (faster convergence)
  const _GINI_ESCALATION = 0.40;   // Gini above this -> 1.5x rate multiplier

  // -- Shared config --
  const _BASELINE_MIN = 0.04;
  const _BASELINE_MAX = 0.40;
  const _WARMUP = 16;

  // -- State --
  /** @type {Record<string, number>} */
  const _smoothedShares = {};
  /** @type {Record<string, number>} */
  const _pairCooldowns = {};
  let _beatCount = 0;
  let _pairAdjustments = 0;
  let _axisAdjustments = 0;
  /** @type {Record<string, number>} */
  const _perAxisAdj = {};
  /** @type {Record<string, number>} */
  const _perPairAdj = {};
  /** @type {Record<string, number>} */
  let _lastBaselines = {};

  // Dimensions + pair mapping (precomputed)
  const _ALL_AXES = ['density', 'tension', 'flicker', 'entropy', 'trust', 'phase'];
  const _ALL_PAIRS = [
    'density-tension', 'density-flicker', 'density-entropy', 'density-phase', 'density-trust',
    'tension-flicker', 'tension-entropy', 'tension-phase', 'tension-trust',
    'flicker-entropy', 'flicker-phase', 'flicker-trust',
    'entropy-phase', 'entropy-trust', 'trust-phase'
  ];
  /** @type {Record<string, string[]>} */
  const _axisToPairs = {};
  for (let a = 0; a < _ALL_AXES.length; a++) {
    const axis = _ALL_AXES[a];
    _axisToPairs[axis] = [];
    for (let p = 0; p < _ALL_PAIRS.length; p++) {
      if (_ALL_PAIRS[p].indexOf(axis) !== -1) _axisToPairs[axis].push(_ALL_PAIRS[p]);
    }
  }

  function refresh() {
    _beatCount++;

    // Tick cooldowns
    const cdKeys = Object.keys(_pairCooldowns);
    for (let i = 0; i < cdKeys.length; i++) {
      if (_pairCooldowns[cdKeys[i]] > 0) _pairCooldowns[cdKeys[i]]--;
    }

    // Read axis energy + pair snapshots
    const energyData = pipelineCouplingManager.getAxisEnergyShare();
    if (!energyData || !energyData.shares) return;
    const shares = energyData.shares;
    const axisGini = V.optionalFinite(energyData.axisGini, 0);

    // Update smoothed axis shares
    for (let a = 0; a < _ALL_AXES.length; a++) {
      const axis = _ALL_AXES[a];
      const raw = V.optionalFinite(shares[axis], 0);
      if (_smoothedShares[axis] === undefined) {
        _smoothedShares[axis] = raw;
      } else {
        _smoothedShares[axis] += (raw - _smoothedShares[axis]) * _SHARE_EMA_ALPHA;
      }
    }

    if (_beatCount < _WARMUP) return;

    const giniMult = axisGini > _GINI_ESCALATION ? 1.5 : 1.0;
    _lastBaselines = pipelineCouplingManager.getPairBaselines();
    const snapshot = pipelineCouplingManager.getAdaptiveTargetSnapshot();

    // R30: Coherent gate -- when the system is in or near coherent regime,
    // freeze ALL tightening. Tightening baselines widens the coupling gap
    // and prevents coherent entry, creating a negative feedback cycle.
    // Only relax (coldspot/undershoot) is allowed during coherent.
    const currentRegime = regimeClassifier.getLastRegime();
    const coherentGate = (currentRegime === 'coherent' || currentRegime === 'evolving');

    // ===== LAYER 1: Pair-level hotspot / coldspot detection =====
    for (let p = 0; p < _ALL_PAIRS.length; p++) {
      const pair = _ALL_PAIRS[p];
      if ((_pairCooldowns[pair] || 0) > 0) continue;
      const pd = snapshot[pair];
      if (!pd) continue;
      const baseline = V.optionalFinite(pd.baseline);
      const rolling = V.optionalFinite(pd.rawRollingAbsCorr);
      if (baseline === undefined || rolling === undefined) continue;

      if (!coherentGate && rolling > _HOTSPOT_RATIO * baseline && rolling > _HOTSPOT_ABS_MIN) {
        // Hotspot -- tighten this pair's baseline
        const overshoot = rolling / m.max(baseline, 0.01);
        const rate = _PAIR_TIGHTEN_RATE * giniMult * clamp(overshoot - _HOTSPOT_RATIO, 0.5, 3.0);
        const nb = m.max(_BASELINE_MIN, baseline - rate);
        if (nb < baseline) {
          pipelineCouplingManager.setPairBaseline(pair, nb);
          _pairCooldowns[pair] = _PAIR_COOLDOWN;
          _pairAdjustments++;
          _perPairAdj[pair] = (_perPairAdj[pair] || 0) + 1;
        }
      } else if (rolling < _COLDSPOT_RATIO * baseline && rolling < _COLDSPOT_ABS_MAX) {
        // Coldspot -- relax this pair's baseline
        const nb = m.min(_BASELINE_MAX, baseline + _PAIR_RELAX_RATE);
        if (nb > baseline) {
          pipelineCouplingManager.setPairBaseline(pair, nb);
          _pairCooldowns[pair] = _PAIR_COOLDOWN;
          _pairAdjustments++;
          _perPairAdj[pair] = (_perPairAdj[pair] || 0) + 1;
        }
      }
    }

    // ===== LAYER 2: Axis-level energy balancing =====
    for (let a = 0; a < _ALL_AXES.length; a++) {
      const axis = _ALL_AXES[a];
      const share = _smoothedShares[axis] || 0;
      const pairs = _axisToPairs[axis];

      if (share > _AXIS_OVERSHOOT && !coherentGate) {
        const excess = share - _FAIR_SHARE;
        const rate = _AXIS_TIGHTEN_RATE * giniMult * clamp(excess / _FAIR_SHARE, 0.5, 2.0);
        for (let p = 0; p < pairs.length; p++) {
          const pair = pairs[p];
          if ((_pairCooldowns[pair] || 0) > 0) continue; // skip Layer-1 adjusted
          const bl = V.optionalFinite(_lastBaselines[pair]);
          if (bl === undefined) continue;
          const nb = m.max(_BASELINE_MIN, bl - rate);
          if (nb < bl) {
            pipelineCouplingManager.setPairBaseline(pair, nb);
            _pairCooldowns[pair] = _AXIS_COOLDOWN;
            _axisAdjustments++;
            _perAxisAdj[axis] = (_perAxisAdj[axis] || 0) + 1;
          }
        }
      } else if (share < _AXIS_UNDERSHOOT && share > 0.001) {
        const deficit = _FAIR_SHARE - share;
        const rate = _AXIS_RELAX_RATE * clamp(deficit / _FAIR_SHARE, 0.5, 2.0);
        for (let p = 0; p < pairs.length; p++) {
          const pair = pairs[p];
          if ((_pairCooldowns[pair] || 0) > 0) continue;
          const bl = V.optionalFinite(_lastBaselines[pair]);
          if (bl === undefined) continue;
          const nb = m.min(_BASELINE_MAX, bl + rate);
          if (nb > bl) {
            pipelineCouplingManager.setPairBaseline(pair, nb);
            _pairCooldowns[pair] = _AXIS_COOLDOWN;
            _axisAdjustments++;
            _perAxisAdj[axis] = (_perAxisAdj[axis] || 0) + 1;
          }
        }
      }
    }

    explainabilityBus.emit('AXIS_ENERGY_EQUIL', 'all', {
      smoothedShares: Object.assign({}, _smoothedShares),
      axisGini, giniMult,
      pairAdj: _pairAdjustments, axisAdj: _axisAdjustments,
      beat: _beatCount
    });
  }

  /** @returns {{ beatCount: number, pairAdjustments: number, axisAdjustments: number, smoothedShares: Record<string, number>, perAxisAdj: Record<string, number>, perPairAdj: Record<string, number>, lastBaselines: Record<string, number> }} */
  function getSnapshot() {
    return {
      beatCount: _beatCount,
      pairAdjustments: _pairAdjustments,
      axisAdjustments: _axisAdjustments,
      smoothedShares: Object.assign({}, _smoothedShares),
      perAxisAdj: Object.assign({}, _perAxisAdj),
      perPairAdj: Object.assign({}, _perPairAdj),
      lastBaselines: Object.assign({}, _lastBaselines)
    };
  }

  function reset() {
    for (let a = 0; a < _ALL_AXES.length; a++) {
      const axis = _ALL_AXES[a];
      if (_smoothedShares[axis] !== undefined) {
        _smoothedShares[axis] = _smoothedShares[axis] * 0.7 + _FAIR_SHARE * 0.3;
      }
    }
    const cdKeys = Object.keys(_pairCooldowns);
    for (let i = 0; i < cdKeys.length; i++) _pairCooldowns[cdKeys[i]] = 0;
  }

  // --- Self-registration ---
  conductorIntelligence.registerRecorder('axisEnergyEquilibrator', refresh);
  conductorIntelligence.registerStateProvider('axisEnergyEquilibrator', () => ({
    axisEnergyEquilibrator: getSnapshot()
  }));
  conductorIntelligence.registerModule('axisEnergyEquilibrator', { reset }, ['section']);

  return { getSnapshot, reset };
})();
