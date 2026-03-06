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

  // R32 E2: Effective nudgeable pair count per axis. Trust/entropy/phase have
  // only 3 nudgeable pairs (both partners must include density/tension/flicker)
  // vs 5 for density/tension/flicker. This causes 40% slower correction for
  // disadvantaged axes. Scale relaxation rate by 5/count to compensate.
  const _EFFECTIVE_NUDGEABLE = {
    density: 5, tension: 5, flicker: 5,
    entropy: 3, trust: 3, phase: 3
  };
  const _RELAX_RATE_REF = 5; // reference pair count (density/tension/flicker)

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

  // R32 E5: Per-regime telemetry tracking. Records tightenScale regime
  // breakdown and adjustments per regime for trace-summary extraction.
  /** @type {Record<string, number>} */
  const _regimeBeats = {};
  /** @type {Record<string, number>} */
  const _regimePairAdj = {};
  /** @type {Record<string, number>} */
  const _regimeAxisAdj = {};
  /** @type {Record<string, number>} */
  const _regimeTightenBudget = {};

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

    // R31: Graduated coherent gate. R30's binary gate (freeze during evolving
    // + coherent = 61% of beats) caused axisGini to triple (0.137->0.382)
    // because tightening was blocked for too long. Graduated approach:
    //   exploring/initializing: full tightening (1.0)
    //   evolving: reduced tightening (0.4) -- allows partial axis correction
    //   coherent: frozen (0.0) -- protects coherent stability
    const currentRegime = regimeClassifier.getLastRegime();
    // R34 E4: Exploring tighten amplification (1.5x). R33 showed exploring
    // contributes 77% of effective tightening budget. Amplifying during
    // exploring accelerates axis balance correction while coherent is absent.
    // R35 E4: Evolving tightenScale 0.4->0.6. R34 had 83.7% evolving but
    // only 13.7 total tighten budget (R33: 35). Without exploring, evolving
    // must carry more of the tightening load.
    const tightenScale = currentRegime === 'coherent' ? 0.0
      : currentRegime === 'evolving' ? 0.6
      : currentRegime === 'exploring' ? 1.5
      : 1.0;

    // R32 E5: Track per-regime beats and tightening budget
    const rKey = currentRegime || 'unknown';
    _regimeBeats[rKey] = (_regimeBeats[rKey] || 0) + 1;
    _regimeTightenBudget[rKey] = (_regimeTightenBudget[rKey] || 0) + tightenScale;

    // ===== LAYER 1: Pair-level hotspot / coldspot detection =====
    for (let p = 0; p < _ALL_PAIRS.length; p++) {
      const pair = _ALL_PAIRS[p];
      if ((_pairCooldowns[pair] || 0) > 0) continue;
      const pd = snapshot[pair];
      if (!pd) continue;
      const baseline = V.optionalFinite(pd.baseline);
      const rolling = V.optionalFinite(pd.rawRollingAbsCorr);
      if (baseline === undefined || rolling === undefined) continue;

      if (tightenScale > 0 && rolling > _HOTSPOT_RATIO * baseline && rolling > _HOTSPOT_ABS_MIN) {
        // Hotspot -- tighten this pair's baseline (scaled by regime gate)
        const overshoot = rolling / m.max(baseline, 0.01);
        const rate = _PAIR_TIGHTEN_RATE * tightenScale * giniMult * clamp(overshoot - _HOTSPOT_RATIO, 0.5, 3.0);
        const nb = m.max(_BASELINE_MIN, baseline - rate);
        if (nb < baseline) {
          pipelineCouplingManager.setPairBaseline(pair, nb);
          _pairCooldowns[pair] = _PAIR_COOLDOWN;
          _pairAdjustments++;
          _perPairAdj[pair] = (_perPairAdj[pair] || 0) + 1;
          _regimePairAdj[rKey] = (_regimePairAdj[rKey] || 0) + 1;
        }
      } else if (rolling < _COLDSPOT_RATIO * baseline && rolling < _COLDSPOT_ABS_MAX) {
        // Coldspot -- relax this pair's baseline
        const nb = m.min(_BASELINE_MAX, baseline + _PAIR_RELAX_RATE);
        if (nb > baseline) {
          pipelineCouplingManager.setPairBaseline(pair, nb);
          _pairCooldowns[pair] = _PAIR_COOLDOWN;
          _pairAdjustments++;
          _perPairAdj[pair] = (_perPairAdj[pair] || 0) + 1;
          _regimePairAdj[rKey] = (_regimePairAdj[rKey] || 0) + 1;
        }
      }
    }

    // ===== LAYER 2: Axis-level energy balancing =====
    const entropyExploringDamp = rKey === 'exploring' ? 0.95 : 1.0;

    for (let a = 0; a < _ALL_AXES.length; a++) {
      const axis = _ALL_AXES[a];
      const share = _smoothedShares[axis] || 0;
      const pairs = _axisToPairs[axis];

      if (share > _AXIS_OVERSHOOT && tightenScale > 0) {
        const excess = share - _FAIR_SHARE;
        // R39 E1: Entropy Axis Soft-Throttle. Apply 0.95x dampening strictly to entropy during exploring.
        const dampMult = (axis === 'entropy') ? entropyExploringDamp : 1.0;

        // R33 E2: Symmetric tighten-rate scaling. R32 E2 only scaled relaxation
        // for disadvantaged axes (trust/entropy/phase). But overshoot tightening
        // also needs scaling: entropy at 0.230 share pushes energy toward trust,
        // and its 3-pair axis needs 1.67x faster tightening to match 5-pair axes.
        const tightenPairScale = _RELAX_RATE_REF / (_EFFECTIVE_NUDGEABLE[axis] || _RELAX_RATE_REF);
        const rate = _AXIS_TIGHTEN_RATE * tightenPairScale * tightenScale * giniMult * dampMult * clamp(excess / _FAIR_SHARE, 0.5, 2.0);
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
            _regimeAxisAdj[rKey] = (_regimeAxisAdj[rKey] || 0) + 1;
          }
        }
      } else if (share < _AXIS_UNDERSHOOT && share > 0.001) {
        const deficit = _FAIR_SHARE - share;
        // R32 E2: Scale relaxation rate by inverse nudgeable pair count.
        // Trust/entropy/phase axes have only 3 effective nudgeable pairs vs 5,
        // so they need 5/3 = 1.67x faster relaxation to match correction speed.
        const pairScale = _RELAX_RATE_REF / (_EFFECTIVE_NUDGEABLE[axis] || _RELAX_RATE_REF);
        const rate = _AXIS_RELAX_RATE * pairScale * clamp(deficit / _FAIR_SHARE, 0.5, 2.0);
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
            _regimeAxisAdj[rKey] = (_regimeAxisAdj[rKey] || 0) + 1;
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

  /** @returns {{ beatCount: number, pairAdjustments: number, axisAdjustments: number, smoothedShares: Record<string, number>, perAxisAdj: Record<string, number>, perPairAdj: Record<string, number>, lastBaselines: Record<string, number>, regimeBeats: Record<string, number>, regimePairAdj: Record<string, number>, regimeAxisAdj: Record<string, number>, regimeTightenBudget: Record<string, number> }} */
  function getSnapshot() {
    return {
      beatCount: _beatCount,
      pairAdjustments: _pairAdjustments,
      axisAdjustments: _axisAdjustments,
      smoothedShares: Object.assign({}, _smoothedShares),
      perAxisAdj: Object.assign({}, _perAxisAdj),
      perPairAdj: Object.assign({}, _perPairAdj),
      lastBaselines: Object.assign({}, _lastBaselines),
      // R32 E5: Per-regime telemetry
      regimeBeats: Object.assign({}, _regimeBeats),
      regimePairAdj: Object.assign({}, _regimePairAdj),
      regimeAxisAdj: Object.assign({}, _regimeAxisAdj),
      regimeTightenBudget: Object.assign({}, _regimeTightenBudget)
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
