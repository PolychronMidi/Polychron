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
  const _RESIDUAL_P95_RATIO = 1.55;
  const _RESIDUAL_P95_ABS_MIN = 0.68;
  const _RESIDUAL_HOTSPOT_RATE = 0.12;
  const _RESIDUAL_SEVERE_RATE = 0.03;
  const _RESIDUAL_COLDSPOT_P95_MAX = 0.66;
  const _RESIDUAL_TIGHTEN_BONUS = 1.35;

  // -- Layer 2 config: axis-level energy balancing --
  const _FAIR_SHARE = 1.0 / 6.0;
  const _AXIS_OVERSHOOT = 0.22;    // share > 0.22 triggers tightening
  const _AXIS_UNDERSHOOT = 0.12;   // share < 0.12 triggers relaxation
  const _AXIS_TIGHTEN_RATE = 0.002;
  const _AXIS_RELAX_RATE = 0.0012;
  const _AXIS_COOLDOWN = 4;
  const _SHARE_EMA_ALPHA = 0.08;   // ~12-beat horizon (faster convergence)
  const _GINI_ESCALATION = 0.40;   // Gini above this -> 1.5x rate multiplier
  const _NON_NUDGEABLE_TAIL_SET = new Set(['entropy-trust', 'entropy-phase', 'trust-phase']);

  // -- Shared config --
  const _BASELINE_MIN = 0.04;
  const _BASELINE_MAX = 0.40;
  const _WARMUP_DEFAULT = 16;
  const _PHASE_SURFACE_RATIO = 1.6;
  const _PHASE_SURFACE_ABS_MIN = 0.18;
  const _TRUST_SURFACE_RATIO = 1.45;
  const _TRUST_SURFACE_ABS_MIN = 0.20;
  const _ENTROPY_SURFACE_RATIO = 1.35;
  const _ENTROPY_SURFACE_ABS_MIN = 0.18;
  const _COHERENT_HOTSPOT_MIN_SCALE = 0.18;
  const _COHERENT_HOTSPOT_MAX_SCALE = 0.42;

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
  let _coherentFreezeBeats = 0;
  let _skippedColdspotRelaxations = 0;
  let _phaseSurfaceHotBeats = 0;
  let _trustSurfaceHotBeats = 0;
  let _entropySurfaceHotBeats = 0;
  let _coherentHotspotActuationBeats = 0;
  let _coherentHotspotPairAdj = 0;
  let _coherentHotspotAxisAdj = 0;
  let _lastWarmupTicks = _WARMUP_DEFAULT;

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

  function _getWarmupTicks() {
    let profile = null;
    try {
      profile = conductorConfig.getActiveProfile();
    } catch {
      profile = null;
    }
    const analysis = profile && typeof profile.analysis === 'object' ? profile.analysis : null;
    const configuredWarmup = analysis && Number.isFinite(analysis.warmupTicks)
      ? m.round(analysis.warmupTicks)
      : 6;
    const shortRunCompression = Number.isFinite(totalSections) && totalSections > 0 && totalSections <= 5 ? 2 : 0;
    return clamp(configuredWarmup + 2 - shortRunCompression, 4, _WARMUP_DEFAULT);
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

    _lastWarmupTicks = _getWarmupTicks();
    if (_beatCount < _lastWarmupTicks) return;

    const giniMult = axisGini > _GINI_ESCALATION ? 1.5 : 1.0;
    const homeostasisState = safePreBoot.call(() => couplingHomeostasis.getState(), null);
    const recoveryAxisHandOffPressure = homeostasisState && typeof homeostasisState.recoveryAxisHandOffPressure === 'number'
      ? homeostasisState.recoveryAxisHandOffPressure
      : 0;
    const shortRunRecoveryBias = homeostasisState && typeof homeostasisState.shortRunRecoveryBias === 'number'
      ? homeostasisState.shortRunRecoveryBias
      : 0;
    const nonNudgeableTailPressure = homeostasisState && typeof homeostasisState.nonNudgeableTailPressure === 'number'
      ? homeostasisState.nonNudgeableTailPressure
      : 0;
    const nonNudgeableTailPair = homeostasisState && typeof homeostasisState.nonNudgeableTailPair === 'string'
      ? homeostasisState.nonNudgeableTailPair
      : '';
    const recoveryDominantAxes = homeostasisState && Array.isArray(homeostasisState.recoveryDominantAxes)
      ? homeostasisState.recoveryDominantAxes
      : [];
    const nonNudgeableAxes = nonNudgeableTailPair && nonNudgeableTailPair.indexOf('-') !== -1
      ? nonNudgeableTailPair.split('-')
      : recoveryDominantAxes;
    const densityFlickerAxisLock = recoveryDominantAxes.indexOf('density') !== -1 && recoveryDominantAxes.indexOf('flicker') !== -1;
    _lastBaselines = pipelineCouplingManager.getPairBaselines();
    const snapshot = pipelineCouplingManager.getAdaptiveTargetSnapshot();
    let phaseSurfaceHot = false;
    let phaseSurfacePressure = 0;
    const phaseSurfacePairs = ['density-phase', 'flicker-phase', 'tension-phase'];
    for (let p = 0; p < phaseSurfacePairs.length; p++) {
      const pair = phaseSurfacePairs[p];
      const pd = snapshot[pair];
      if (!pd) continue;
      const baseline = V.optionalFinite(pd.baseline, 0);
      const rolling = V.optionalFinite(pd.rawRollingAbsCorr, 0);
      const pairP95 = V.optionalFinite(pd.p95AbsCorr, rolling);
      const hotspotRate = V.optionalFinite(pd.hotspotRate, 0);
      const severeRate = V.optionalFinite(pd.severeRate, 0);
      const pairPressure = clamp(
        clamp((rolling - m.max(_PHASE_SURFACE_ABS_MIN, baseline * _PHASE_SURFACE_RATIO)) / 0.18, 0, 1) * 0.30 +
        clamp((pairP95 - m.max(_PHASE_SURFACE_ABS_MIN + 0.12, baseline * (_PHASE_SURFACE_RATIO + 0.25))) / 0.16, 0, 1) * 0.40 +
        clamp((hotspotRate - 0.18) / 0.18, 0, 1) * 0.18 +
        clamp((severeRate - 0.03) / 0.10, 0, 1) * 0.12,
        0,
        1
      );
      if (pairPressure > 0) {
        phaseSurfaceHot = true;
        phaseSurfacePressure = m.max(phaseSurfacePressure, pairPressure);
      }
    }
    let trustSurfaceHot = false;
    let trustSurfacePressure = 0;
    const trustSurfacePairs = ['density-trust', 'flicker-trust', 'tension-trust'];
    for (let p = 0; p < trustSurfacePairs.length; p++) {
      const pair = trustSurfacePairs[p];
      const pd = snapshot[pair];
      if (!pd) continue;
      const baseline = V.optionalFinite(pd.baseline, 0);
      const rolling = V.optionalFinite(pd.rawRollingAbsCorr, 0);
      const pairP95 = V.optionalFinite(pd.p95AbsCorr, rolling);
      const hotspotRate = V.optionalFinite(pd.hotspotRate, 0);
      const severeRate = V.optionalFinite(pd.severeRate, 0);
      const pairPressure = clamp(
        clamp((rolling - m.max(_TRUST_SURFACE_ABS_MIN, baseline * _TRUST_SURFACE_RATIO)) / 0.18, 0, 1) * 0.30 +
        clamp((pairP95 - m.max(_TRUST_SURFACE_ABS_MIN + 0.10, baseline * (_TRUST_SURFACE_RATIO + 0.20))) / 0.16, 0, 1) * 0.40 +
        clamp((hotspotRate - 0.16) / 0.18, 0, 1) * 0.18 +
        clamp((severeRate - 0.03) / 0.10, 0, 1) * 0.12,
        0,
        1
      );
      if (pairPressure > 0) {
        trustSurfaceHot = true;
        trustSurfacePressure = m.max(trustSurfacePressure, pairPressure);
      }
    }
    if (phaseSurfaceHot) _phaseSurfaceHotBeats++;
    if (trustSurfaceHot) _trustSurfaceHotBeats++;
    let entropySurfaceHot = false;
    let entropySurfacePressure = 0;
    const entropySurfacePairs = ['density-entropy', 'tension-entropy', 'flicker-entropy', 'entropy-trust', 'entropy-phase'];
    for (let p = 0; p < entropySurfacePairs.length; p++) {
      const pair = entropySurfacePairs[p];
      const pd = snapshot[pair];
      if (!pd) continue;
      const baseline = V.optionalFinite(pd.baseline, 0);
      const rolling = V.optionalFinite(pd.rawRollingAbsCorr, 0);
      const pairP95 = V.optionalFinite(pd.p95AbsCorr, rolling);
      const hotspotRate = V.optionalFinite(pd.hotspotRate, 0);
      const severeRate = V.optionalFinite(pd.severeRate, 0);
      const pairPressure = clamp(
        clamp((rolling - m.max(_ENTROPY_SURFACE_ABS_MIN, baseline * _ENTROPY_SURFACE_RATIO)) / 0.18, 0, 1) * 0.30 +
        clamp((pairP95 - m.max(_ENTROPY_SURFACE_ABS_MIN + 0.10, baseline * (_ENTROPY_SURFACE_RATIO + 0.20))) / 0.16, 0, 1) * 0.40 +
        clamp((hotspotRate - 0.16) / 0.18, 0, 1) * 0.18 +
        clamp((severeRate - 0.04) / 0.10, 0, 1) * 0.12,
        0,
        1
      );
      if (pairPressure > 0) {
        entropySurfaceHot = true;
        entropySurfacePressure = m.max(entropySurfacePressure, pairPressure);
      }
    }
    if (entropySurfaceHot) _entropySurfaceHotBeats++;

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
    const coherentHotspotScale = currentRegime === 'coherent' && (phaseSurfaceHot || trustSurfaceHot)
      ? clamp(_COHERENT_HOTSPOT_MIN_SCALE + phaseSurfacePressure * 0.14 + trustSurfacePressure * 0.12 + entropySurfacePressure * 0.10, _COHERENT_HOTSPOT_MIN_SCALE, _COHERENT_HOTSPOT_MAX_SCALE)
      : 0;
    if (coherentHotspotScale > 0) _coherentHotspotActuationBeats++;
    const tightenScale = currentRegime === 'coherent' ? 0.0
      : currentRegime === 'evolving' ? 0.6
      : currentRegime === 'exploring' ? 1.5
      : 1.0;
    const coherentColdspotFreeze = currentRegime === 'coherent' && (phaseSurfaceHot || trustSurfaceHot || entropySurfaceHot);
    if (coherentColdspotFreeze) _coherentFreezeBeats++;

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
      const pairP95 = V.optionalFinite(pd.p95AbsCorr, rolling);
      const hotspotRate = V.optionalFinite(pd.hotspotRate, 0);
      const severeRate = V.optionalFinite(pd.severeRate, 0);
      const residualPressure = V.optionalFinite(pd.residualPressure, 0);
      const budgetRank = V.optionalFinite(pd.budgetRank, 99);
      const residualTailHot = pairP95 > m.max(_RESIDUAL_P95_ABS_MIN, baseline * _RESIDUAL_P95_RATIO)
        || hotspotRate > _RESIDUAL_HOTSPOT_RATE
        || severeRate > _RESIDUAL_SEVERE_RATE
        || residualPressure > 0.28;

      const isPhaseSurfacePair = pair === 'density-phase' || pair === 'flicker-phase' || pair === 'tension-phase';
      const isTrustSurfacePair = pair === 'density-trust' || pair === 'flicker-trust' || pair === 'tension-trust';
      const isEntropySurfacePair = pair === 'density-entropy' || pair === 'tension-entropy' || pair === 'flicker-entropy' || pair === 'entropy-trust' || pair === 'entropy-phase';
      const coherentPairEligible = isPhaseSurfacePair || isTrustSurfacePair || isEntropySurfacePair || pair === 'density-flicker';
      const pairTightenScale = currentRegime === 'coherent'
        ? (coherentPairEligible && (residualTailHot || rolling > _HOTSPOT_RATIO * baseline) ? coherentHotspotScale : 0)
        : tightenScale;

      if (pairTightenScale > 0 && ((rolling > _HOTSPOT_RATIO * baseline && rolling > _HOTSPOT_ABS_MIN) || residualTailHot)) {
        // Hotspot -- tighten this pair's baseline (scaled by regime gate)
        const overshoot = m.max(rolling / m.max(baseline, 0.01), pairP95 / m.max(baseline, 0.01));
        const residualTightenPressure = clamp(
          clamp((pairP95 - m.max(_RESIDUAL_P95_ABS_MIN, baseline * _RESIDUAL_P95_RATIO)) / 0.18, 0, 1) * 0.55 +
          clamp((hotspotRate - _RESIDUAL_HOTSPOT_RATE) / 0.20, 0, 1) * 0.25 +
          clamp((severeRate - _RESIDUAL_SEVERE_RATE) / 0.12, 0, 1) * 0.20,
          0,
          1
        );
        const phaseSurfaceBoost = isPhaseSurfacePair ? 1.35 : 1.0;
        const entropySurfaceBoost = isEntropySurfacePair ? 1.28 : 1.0;
        const rankBoost = budgetRank <= 1 ? 1.30 : budgetRank <= 3 ? 1.16 : 1.0;
        const coherentHotBoost = currentRegime === 'coherent' && coherentPairEligible ? (isEntropySurfacePair ? 1.18 : 1.10) : 1.0;
        const shortRunHandOffBoost = recoveryAxisHandOffPressure > 0 && densityFlickerAxisLock && (pair === 'density-flicker' || isPhaseSurfacePair)
          ? 1 + recoveryAxisHandOffPressure * (0.22 + shortRunRecoveryBias * 0.25)
          : 1.0;
        const nonNudgeableHandOffBoost = nonNudgeableTailPressure > 0 && !_NON_NUDGEABLE_TAIL_SET.has(pair) && Array.isArray(nonNudgeableAxes) && nonNudgeableAxes.length > 0 && (
          pair.indexOf(nonNudgeableAxes[0]) !== -1 || (nonNudgeableAxes[1] && pair.indexOf(nonNudgeableAxes[1]) !== -1)
        )
          ? 1 + nonNudgeableTailPressure * (isEntropySurfacePair ? 0.70 : (isPhaseSurfacePair || isTrustSurfacePair ? 0.52 : 0.32))
          : 1.0;
        const rate = _PAIR_TIGHTEN_RATE * pairTightenScale * giniMult * phaseSurfaceBoost * entropySurfaceBoost * rankBoost * coherentHotBoost * shortRunHandOffBoost * nonNudgeableHandOffBoost * (1 + residualTightenPressure * _RESIDUAL_TIGHTEN_BONUS) * clamp(overshoot - _HOTSPOT_RATIO, 0.5, 3.0);
        const nb = m.max(_BASELINE_MIN, baseline - rate);
        if (nb < baseline) {
          pipelineCouplingManager.setPairBaseline(pair, nb);
          _pairCooldowns[pair] = _PAIR_COOLDOWN;
          _pairAdjustments++;
          if (currentRegime === 'coherent' && pairTightenScale > 0) _coherentHotspotPairAdj++;
          _perPairAdj[pair] = (_perPairAdj[pair] || 0) + 1;
          _regimePairAdj[rKey] = (_regimePairAdj[rKey] || 0) + 1;
        }
      } else if (rolling < _COLDSPOT_RATIO * baseline && rolling < _COLDSPOT_ABS_MAX) {
        if (coherentColdspotFreeze || pairP95 > _RESIDUAL_COLDSPOT_P95_MAX || hotspotRate > 0.06 || severeRate > 0.02) {
          _skippedColdspotRelaxations++;
          continue;
        }
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
    // R43 E5: Phase-Axis Re-Amplification
    // Relaxed dampening back to 0.95 since axisGini stabilized at 0.1065
    const phaseEvolvingDamp = rKey === 'evolving' ? 0.95 : 1.0;

    // R58 E1: Axis-dominant coherent-gate tightening. When an axis's coupling
    // total exceeds the median by >20%, amplify its tightening rate proportionally.
    // Self-correcting: the amplifier scales with the excess above median.
    const axisTotals = pipelineCouplingManager.getAxisCouplingTotals();
    const axisTotalValues = [];
    for (let a = 0; a < _ALL_AXES.length; a++) {
      const av = axisTotals[_ALL_AXES[a]];
      if (typeof av === 'number' && Number.isFinite(av)) axisTotalValues.push(av);
    }
    axisTotalValues.sort(function(a, b) { return a - b; });
    const _axisTotalMedian = axisTotalValues.length > 0
      ? axisTotalValues[m.floor(axisTotalValues.length / 2)]
      : 0;

    for (let a = 0; a < _ALL_AXES.length; a++) {
      const axis = _ALL_AXES[a];
      const share = _smoothedShares[axis] || 0;
      const pairs = _axisToPairs[axis];

      const axisTightenScale = currentRegime === 'coherent'
        ? ((((axis === 'phase' || axis === 'density' || axis === 'flicker') && phaseSurfaceHot) ||
            ((axis === 'trust' || axis === 'density' || axis === 'tension' || axis === 'flicker') && trustSurfaceHot))
          || (((axis === 'entropy' || axis === 'density' || axis === 'tension' || axis === 'flicker') && entropySurfaceHot))
          ? coherentHotspotScale
          : 0)
        : tightenScale;

      if (share > _AXIS_OVERSHOOT && axisTightenScale > 0) {
        const excess = share - _FAIR_SHARE;
        // R39 E1: Entropy Axis Soft-Throttle. Apply 0.95x dampening strictly to entropy during exploring.
        let dampMult = (axis === 'entropy') ? entropyExploringDamp : 1.0;
        if (axis === 'phase') dampMult *= phaseEvolvingDamp;
        if (axis === 'entropy' && entropySurfaceHot) dampMult *= 1 + entropySurfacePressure * 0.35;

        // R44 E3: Flicker Axis Dampening Core (self-correcting relative to overshoot)
        if (axis === 'flicker' && share > 0.20) {
           dampMult *= (1.0 - m.min(0.15, (share - 0.20) * 1.5)); // max 0.85 dampening
        }

        // E2: Density Axis Dampening
        if (axis === 'density' && share > 0.25) {
          dampMult -= 0.05;
        }
        if (recoveryAxisHandOffPressure > 0 && densityFlickerAxisLock && (axis === 'density' || axis === 'flicker')) {
          dampMult *= 1 + recoveryAxisHandOffPressure * (0.40 + shortRunRecoveryBias * 0.35);
        }
        if (nonNudgeableTailPressure > 0 && nonNudgeableAxes.indexOf(axis) !== -1) {
          dampMult *= 1 + nonNudgeableTailPressure * 0.35;
        }

        // R58 E1: Axis-dominant tightening amplifier. When this axis's coupling
        // total exceeds the median by >20%, amplify its tightening proportional
        // to the excess. Caps at 1.5x to prevent over-correction.
        const _thisAxisTotal = typeof axisTotals[axis] === 'number' && Number.isFinite(axisTotals[axis]) ? axisTotals[axis] : 0;
        if (_axisTotalMedian > 0.01 && _thisAxisTotal > _axisTotalMedian * 1.20) {
          const _axisDominanceExcess = (_thisAxisTotal - _axisTotalMedian) / _axisTotalMedian;
          dampMult *= 1 + clamp(_axisDominanceExcess * 0.50, 0, 0.50);
        }

        // R33 E2: Symmetric tighten-rate scaling. R32 E2 only scaled relaxation
        // for disadvantaged axes (trust/entropy/phase). But overshoot tightening
        // also needs scaling: entropy at 0.230 share pushes energy toward trust,
        // and its 3-pair axis needs 1.67x faster tightening to match 5-pair axes.
        const tightenPairScale = _RELAX_RATE_REF / (_EFFECTIVE_NUDGEABLE[axis] || _RELAX_RATE_REF);
        const rate = _AXIS_TIGHTEN_RATE * tightenPairScale * axisTightenScale * giniMult * dampMult * clamp(excess / _FAIR_SHARE, 0.5, 2.0);
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
            if (currentRegime === 'coherent' && axisTightenScale > 0) _coherentHotspotAxisAdj++;
            _perAxisAdj[axis] = (_perAxisAdj[axis] || 0) + 1;
            _regimeAxisAdj[rKey] = (_regimeAxisAdj[rKey] || 0) + 1;
          }
        }
      } else if (share < _AXIS_UNDERSHOOT && share > 0.001) {
        if (coherentColdspotFreeze || (axis === 'phase' && phaseSurfaceHot) || (axis === 'trust' && trustSurfaceHot)) {
          _skippedColdspotRelaxations++;
          continue;
        }
        const deficit = _FAIR_SHARE - share;
        // R32 E2: Scale relaxation rate by inverse nudgeable pair count.
        // Trust/entropy/phase axes have only 3 effective nudgeable pairs vs 5,
        // so they need 5/3 = 1.67x faster relaxation to match correction speed.
        const pairScale = _RELAX_RATE_REF / (_EFFECTIVE_NUDGEABLE[axis] || _RELAX_RATE_REF);
        const handOffRelaxBoost = recoveryAxisHandOffPressure > 0 && densityFlickerAxisLock && axis !== 'density' && axis !== 'flicker'
          ? 1 + recoveryAxisHandOffPressure * (0.55 + shortRunRecoveryBias * 0.40)
          : 1.0;
        const nonNudgeableRelaxBoost = nonNudgeableTailPressure > 0 && nonNudgeableAxes.indexOf(axis) !== -1
          ? 1 + nonNudgeableTailPressure * 0.30
          : 1.0;
        const rate = _AXIS_RELAX_RATE * pairScale * handOffRelaxBoost * nonNudgeableRelaxBoost * clamp(deficit / _FAIR_SHARE, 0.5, 2.0);
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

    // R59 E4: Tension axis energy floor enforcement. When tension share drops
    // below 15%, apply targeted relaxation to tension-containing pairs regardless
    // of coherent freeze or surface-hot guards. Self-correcting: relaxation
    // stops as soon as tension share recovers above the floor.
    const _TENSION_FLOOR = 0.15;
    const _tensionSmoothed = _smoothedShares['tension'];
    if (typeof _tensionSmoothed === 'number' && _tensionSmoothed < _TENSION_FLOOR && _tensionSmoothed > 0.001) {
      const _tensionDeficit = _TENSION_FLOOR - _tensionSmoothed;
      const _tensionPairScale = _RELAX_RATE_REF / (_EFFECTIVE_NUDGEABLE['tension'] || _RELAX_RATE_REF);
      const _tensionFloorRate = m.min(0.03, _AXIS_RELAX_RATE * 2.5 * _tensionPairScale * clamp(_tensionDeficit / _FAIR_SHARE, 0.5, 2.0));
      const _tensionPairs = _axisToPairs['tension'] || [];
      for (let tp = 0; tp < _tensionPairs.length; tp++) {
        const tPair = _tensionPairs[tp];
        if ((_pairCooldowns[tPair] || 0) > 0) continue;
        const tBl = V.optionalFinite(_lastBaselines[tPair]);
        if (tBl === undefined) continue;
        const tNb = m.min(_BASELINE_MAX, tBl + _tensionFloorRate);
        if (tNb > tBl) {
          pipelineCouplingManager.setPairBaseline(tPair, tNb);
          _pairCooldowns[tPair] = _AXIS_COOLDOWN;
          _axisAdjustments++;
          _perAxisAdj['tension'] = (_perAxisAdj['tension'] || 0) + 1;
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

  /** @returns {{ beatCount: number, pairAdjustments: number, axisAdjustments: number, smoothedShares: Record<string, number>, perAxisAdj: Record<string, number>, perPairAdj: Record<string, number>, lastBaselines: Record<string, number>, regimeBeats: Record<string, number>, regimePairAdj: Record<string, number>, regimeAxisAdj: Record<string, number>, regimeTightenBudget: Record<string, number>, coherentFreezeBeats: number, skippedColdspotRelaxations: number, phaseSurfaceHotBeats: number, trustSurfaceHotBeats: number, entropySurfaceHotBeats: number, coherentHotspotActuationBeats: number, coherentHotspotPairAdj: number, coherentHotspotAxisAdj: number, warmupTicks: number, warmupRemaining: number }} */
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
      regimeTightenBudget: Object.assign({}, _regimeTightenBudget),
      coherentFreezeBeats: _coherentFreezeBeats,
      skippedColdspotRelaxations: _skippedColdspotRelaxations,
      phaseSurfaceHotBeats: _phaseSurfaceHotBeats,
      trustSurfaceHotBeats: _trustSurfaceHotBeats,
      entropySurfaceHotBeats: _entropySurfaceHotBeats,
      coherentHotspotActuationBeats: _coherentHotspotActuationBeats,
      coherentHotspotPairAdj: _coherentHotspotPairAdj,
      coherentHotspotAxisAdj: _coherentHotspotAxisAdj,
      warmupTicks: _lastWarmupTicks,
      warmupRemaining: m.max(0, _lastWarmupTicks - _beatCount)
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
