// @ts-check

/**
 * Homeostasis Refresh
 *
 * Per-measure coupling energy analysis registered as a conductor
 * recorder. Runs AFTER pipelineCouplingManager.refresh(). Handles
 * matrix caching, total energy computation, tail pressure tracking,
 * non-nudgeable baseline ratchet, energy EMA/floor/budget self-
 * derivation, redistribution detection, Gini coefficient, and
 * delegates to homeostasisTick for multiplier management.
 */

homeostasisRefresh = (() => {
  const { ALL_DIMS, ENERGY_EMA_ALPHA, REDISTRIBUTION_EMA_ALPHA,
    PEAK_DECAY, BUDGET_PEAK_RATIO, PEAK_EMA_CAP_RATIO,
    REDIST_RELATIVE_THRESHOLD, REDIST_COOLDOWN_BEATS, REDIST_COOLDOWN_DECAY,
    TAIL_PRESSURE_EMA_ALPHA, TAIL_PRESSURE_DECAY, TAIL_ACTIVE_THRESHOLD,
    TAIL_RANKED_THRESHOLD, TAIL_PRESSURE_TRIGGER_MIN, TAIL_MEMORY_TOP_K,
    NON_NUDGEABLE_SET, NON_NUDGEABLE_TAIL_SET, TAIL_TRACKED_PAIRS } = homeostasisConstants;

  function refresh() {
    const S = homeostasisState;
    S.invokeCount++;

    const snap = systemDynamicsProfiler.getSnapshot();
    if (!snap || !snap.couplingMatrix) {
      throw new Error('couplingHomeostasis: systemDynamicsProfiler snapshot unavailable');
    }

    const rawMatrix = snap.couplingMatrix;
    let matrix = rawMatrix;
    let hasRealData = false;
    const rawKeys = Object.keys(rawMatrix);
    if (rawKeys.length > 0) {
      S.cachedMatrix = rawMatrix;
      S.cachedMatrixAge = 0;
      hasRealData = true;
    } else {
      S.emptyMatrixBeats++;
      S.cachedMatrixAge++;
      if (Object.keys(S.cachedMatrix).length > 0 && S.cachedMatrixAge <= 12) {
        matrix = S.cachedMatrix;
      } else {
        explainabilityBus.emit('COUPLING_HOMEOSTASIS', 'both', {
          skipped: true, reason: 'no-cached-matrix', invokeCount: S.invokeCount
        });
        return;
      }
    }

    S.beatCount++;

    // 1. Compute total coupling energy
    S.prevPairAbsR = S.pairAbsR;
    S.pairAbsR = {};
    let totalEnergy = 0;
    let pairCount = 0;
    const staleFactor = hasRealData ? 1.0 : m.pow(0.95, S.cachedMatrixAge);

    for (let a = 0; a < ALL_DIMS.length; a++) {
      for (let b = a + 1; b < ALL_DIMS.length; b++) {
        const k = ALL_DIMS[a] + '-' + ALL_DIMS[b];
        const cv = matrix[k];
        if (cv === null || cv === undefined || cv !== cv) continue;
        const ac = m.abs(cv) * staleFactor;
        S.pairAbsR[k] = ac;
        totalEnergy += ac;
        pairCount++;
      }
    }

    // Tail pressure computation
    const adaptiveSnapshot = safePreBoot.call(() => pipelineCouplingManager.getAdaptiveTargetSnapshot(), null);
    /** @type {Array<{ pair: string, pressure: number }>} */
    const rankedTailPairs = [];
    let tailSum = 0;
    let strongestTail = 0;
    let strongestPair = '';
    let strongestNonNudgeableTail = 0;
    let strongestNonNudgeablePair = '';
    let activeTailCount = 0;
    for (let i = 0; i < TAIL_TRACKED_PAIRS.length; i++) {
      const pair = TAIL_TRACKED_PAIRS[i];
      const pairAbs = S.pairAbsR[pair] || 0;
      const adaptiveEntry = adaptiveSnapshot && adaptiveSnapshot[pair] && typeof adaptiveSnapshot[pair] === 'object'
        ? adaptiveSnapshot[pair]
        : null;
      const baseline = adaptiveEntry && typeof adaptiveEntry.baseline === 'number' ? adaptiveEntry.baseline : 0.25;
      const targetAnchor = adaptiveEntry && typeof adaptiveEntry.current === 'number' ? adaptiveEntry.current : baseline;
      const pairP95 = adaptiveEntry && typeof adaptiveEntry.p95AbsCorr === 'number' ? adaptiveEntry.p95AbsCorr : pairAbs;
      const hotspotRate = adaptiveEntry && typeof adaptiveEntry.hotspotRate === 'number' ? adaptiveEntry.hotspotRate : 0;
      const severeRate = adaptiveEntry && typeof adaptiveEntry.severeRate === 'number' ? adaptiveEntry.severeRate : 0;
      const adaptiveHotThreshold = clamp(m.max(0.54, targetAnchor + 0.26, baseline * 1.9), 0.54, 0.82);
      const overshootPressure = clamp((pairAbs - adaptiveHotThreshold) / 0.26, 0, 1);
      const persistentPressure = clamp((pairP95 - adaptiveHotThreshold) / 0.18, 0, 1);
      const hotspotPressure = clamp(hotspotRate / 0.18, 0, 1);
      const severePressure = clamp(severeRate / 0.08, 0, 1);
      const rawTailPressure = clamp(
        overshootPressure * 0.30 +
        persistentPressure * 0.34 +
        hotspotPressure * 0.22 +
        severePressure * 0.14,
        0,
        1
      );
      const prevTailPressure = S.tailPressureByPair[pair] || 0;
      const nextTailPressure = rawTailPressure >= prevTailPressure
        ? prevTailPressure * (1 - TAIL_PRESSURE_EMA_ALPHA) + rawTailPressure * TAIL_PRESSURE_EMA_ALPHA
        : prevTailPressure * TAIL_PRESSURE_DECAY + rawTailPressure * (1 - TAIL_PRESSURE_DECAY);
      S.tailPressureByPair[pair] = Number(nextTailPressure.toFixed(4));
      tailSum += nextTailPressure;
      if (nextTailPressure > strongestTail) {
        strongestTail = nextTailPressure;
        strongestPair = pair;
      }
      if (NON_NUDGEABLE_TAIL_SET.has(pair) && nextTailPressure > strongestNonNudgeableTail) {
        strongestNonNudgeableTail = nextTailPressure;
        strongestNonNudgeablePair = pair;
      }
      if (nextTailPressure > TAIL_ACTIVE_THRESHOLD) activeTailCount++;
      if (nextTailPressure > TAIL_RANKED_THRESHOLD) rankedTailPairs.push({ pair, pressure: nextTailPressure });
    }
    rankedTailPairs.sort(function(a, b) { return b.pressure - a.pressure; });
    S.dominantTailPair = strongestPair;
    S.nonNudgeableTailPressure = strongestNonNudgeableTail;
    S.nonNudgeableTailPair = strongestNonNudgeablePair;

    // Non-nudgeable baseline auto-ratchet
    if (strongestNonNudgeableTail > 0.50 && strongestNonNudgeablePair && S.beatCount > 30) {
      const _nnAdaptive = adaptiveSnapshot && adaptiveSnapshot[strongestNonNudgeablePair];
      if (_nnAdaptive && typeof _nnAdaptive.rawRollingAbsCorr === 'number' && typeof _nnAdaptive.baseline === 'number') {
        const _nnTarget = clamp(_nnAdaptive.rawRollingAbsCorr * 0.85, 0.04, 0.30);
        if (_nnAdaptive.baseline < _nnTarget) {
          const _nnRatchetRate = 0.0008 * clamp((strongestNonNudgeableTail - 0.50) / 0.30, 0.2, 1.0);
          pipelineCouplingManager.setPairBaseline(strongestNonNudgeablePair, clamp(_nnAdaptive.baseline + _nnRatchetRate, 0.04, _nnTarget));
        }
      }
    }
    S.tailHotspotCount = activeTailCount;
    const tailAverage = TAIL_TRACKED_PAIRS.length > 0 ? tailSum / TAIL_TRACKED_PAIRS.length : 0;
    let topTailMean = 0;
    const topCount = m.min(TAIL_MEMORY_TOP_K, rankedTailPairs.length);
    for (let i = 0; i < topCount; i++) topTailMean += rankedTailPairs[i].pressure;
    topTailMean = topCount > 0 ? topTailMean / topCount : 0;
    const tailCoverage = TAIL_TRACKED_PAIRS.length > 0 ? activeTailCount / TAIL_TRACKED_PAIRS.length : 0;
    const structuralTailPressure = clamp(
      clamp((S.redistributionScore - 0.18) / 0.45, 0, 1) * 0.40 +
      clamp((S.nudgeableRedistributionScore - 0.18) / 0.45, 0, 1) * 0.20 +
      clamp((S.giniCoefficient - 0.34) / 0.16, 0, 1) * 0.20 +
      clamp((S.totalEnergyEma - S.energyBudget) / m.max(S.energyBudget, 0.1), 0, 1) * 0.20,
      0,
      1
    );
    const tailAggregate = clamp(
      strongestTail * 0.45 +
      m.max(tailAverage, topTailMean) * 0.35 +
      tailCoverage * 0.10 +
      structuralTailPressure * 0.10,
      0,
      1
    );
    S.stickyTailPressure = tailAggregate >= S.stickyTailPressure
      ? S.stickyTailPressure * (1 - TAIL_PRESSURE_EMA_ALPHA) + tailAggregate * TAIL_PRESSURE_EMA_ALPHA
      : S.stickyTailPressure * TAIL_PRESSURE_DECAY + tailAggregate * (1 - TAIL_PRESSURE_DECAY);
    S.densityFlickerTailPressure = S.tailPressureByPair['density-flicker'] || 0;
    S.tailRecoveryDrive = Number(clamp(tailAggregate * 0.52 + structuralTailPressure * 0.20 + strongestTail * 0.28, 0, 1).toFixed(4));
    S.tailRecoveryTrigger = Number(clamp(TAIL_PRESSURE_TRIGGER_MIN + structuralTailPressure * 0.06 + m.max(0, tailCoverage - 0.15) * 0.06, TAIL_PRESSURE_TRIGGER_MIN, 0.26).toFixed(4));

    if (pairCount === 0) return;

    // Update total energy EMA
    if (S.beatCount <= 2) {
      S.totalEnergyEma = totalEnergy;
    } else {
      S.totalEnergyEma = S.totalEnergyEma * (1 - ENERGY_EMA_ALPHA) + totalEnergy * ENERGY_EMA_ALPHA;
    }

    // Structural floor (asymmetric: fast down, slow up)
    if (S.totalEnergyEma < S.totalEnergyFloor) {
      S.totalEnergyFloor = S.totalEnergyFloor * 0.80 + S.totalEnergyEma * 0.20;
    } else {
      S.totalEnergyFloor = S.totalEnergyFloor * 0.998 + S.totalEnergyEma * 0.002;
    }

    // 2. Self-derive energy budget from observed peak
    S.peakEnergyEma = m.max(S.totalEnergyEma, S.peakEnergyEma * PEAK_DECAY);
    if (S.totalEnergyEma > 0.1) {
      S.peakEnergyEma = m.min(S.peakEnergyEma, S.totalEnergyEma * PEAK_EMA_CAP_RATIO);
    }
    if (S.energyBudget > S.totalEnergyEma * 1.25 && S.totalEnergyEma > 0.1) {
      S.peakEnergyEma *= 0.98;
    }
    if (S.beatCount >= 8 && S.peakEnergyEma > 0.1) {
      S.energyBudget = S.peakEnergyEma * BUDGET_PEAK_RATIO;
    }
    if (S.beatCount > 150) {
      const _budgetScale = 1 + clamp((S.beatCount - 150) / 300, 0, 0.50);
      S.energyBudget *= _budgetScale;
    }
    const _profileBudgetScale = conductorConfig.getActiveProfile().couplingBudgetScale || 1.0;
    S.energyBudget *= _profileBudgetScale;
    const _dynSnap = systemDynamicsProfiler.getSnapshot();
    if (_dynSnap && _dynSnap.regime === 'exploring') {
      S.energyBudget *= 1.15;
    }
    if (snap.regime === 'exploring' && S.beatCount > 30) {
      S.energyBudget *= 1.15;
    }

    // 3. Detect redistribution
    const energyDelta = totalEnergy - S.prevTotalEnergy;
    S.energyDeltaEma = S.energyDeltaEma * (1 - REDISTRIBUTION_EMA_ALPHA) + energyDelta * REDISTRIBUTION_EMA_ALPHA;

    let pairTurbulence = 0;
    let nudgeablePairTurbulence = 0;
    let nudgeablePairCount = 0;
    const prevKeys = Object.keys(S.prevPairAbsR);
    if (prevKeys.length > 0) {
      let turbSum = 0;
      let nudgeableTurbSum = 0;
      for (let i = 0; i < prevKeys.length; i++) {
        const curr = S.pairAbsR[prevKeys[i]] || 0;
        const prev = S.prevPairAbsR[prevKeys[i]] || 0;
        const delta = m.abs(curr - prev);
        turbSum += delta;
        if (!NON_NUDGEABLE_SET.has(prevKeys[i])) {
          nudgeableTurbSum += delta;
          nudgeablePairCount++;
        }
      }
      pairTurbulence = turbSum / prevKeys.length;
      nudgeablePairTurbulence = nudgeablePairCount > 0 ? nudgeableTurbSum / nudgeablePairCount : 0;
    }
    S.pairTurbulenceEma = S.pairTurbulenceEma * (1 - REDISTRIBUTION_EMA_ALPHA) + pairTurbulence * REDISTRIBUTION_EMA_ALPHA;
    S.nudgeablePairTurbulenceEma = S.nudgeablePairTurbulenceEma * (1 - REDISTRIBUTION_EMA_ALPHA) + nudgeablePairTurbulence * REDISTRIBUTION_EMA_ALPHA;

    const relativeTurbulence = S.totalEnergyEma > 0.1
      ? S.pairTurbulenceEma / S.totalEnergyEma
      : 0;
    const isPrimaryRedistributing = S.prevTotalEnergy > 0.1 &&
      m.abs(S.energyDeltaEma) / S.totalEnergyEma < 0.05 &&
      relativeTurbulence > REDIST_RELATIVE_THRESHOLD;
    const isGiniConcentrated = S.giniCoefficient > 0.35 && S.prevTotalEnergy > 0.1;
    const isRedistributing = isPrimaryRedistributing || isGiniConcentrated;
    const redistTarget = isRedistributing ? 1.0 : 0.0;
    S.redistributionScore = S.redistributionScore * (1 - REDISTRIBUTION_EMA_ALPHA) + redistTarget * REDISTRIBUTION_EMA_ALPHA;

    const nudgeableRelativeTurbulence = S.totalEnergyEma > 0.1
      ? S.nudgeablePairTurbulenceEma / S.totalEnergyEma
      : 0;
    const isNudgeableRedistributing = S.prevTotalEnergy > 0.1 &&
      m.abs(S.energyDeltaEma) / S.totalEnergyEma < 0.05 &&
      nudgeableRelativeTurbulence > REDIST_RELATIVE_THRESHOLD;
    const isNudgeableRedist = isNudgeableRedistributing || isGiniConcentrated;
    const nudgeableRedistTarget = isNudgeableRedist ? 1.0 : 0.0;
    S.nudgeableRedistributionScore = S.nudgeableRedistributionScore * (1 - REDISTRIBUTION_EMA_ALPHA) + nudgeableRedistTarget * REDISTRIBUTION_EMA_ALPHA;

    if (!isRedistributing) {
      S.nonRedistBeats++;
      if (S.nonRedistBeats > REDIST_COOLDOWN_BEATS) {
        S.redistributionScore *= REDIST_COOLDOWN_DECAY;
      }
    } else {
      S.nonRedistBeats = 0;
    }
    if (!isNudgeableRedist) {
      S.nudgeableNonRedistBeats++;
      if (S.nudgeableNonRedistBeats > REDIST_COOLDOWN_BEATS) {
        S.nudgeableRedistributionScore *= REDIST_COOLDOWN_DECAY;
      }
    } else {
      S.nudgeableNonRedistBeats = 0;
    }

    S.prevTotalEnergy = totalEnergy;
    S.overBudget = S.totalEnergyEma > S.energyBudget;

    // 5. Coupling concentration guard (Gini coefficient)
    const pairKeys = Object.keys(S.pairAbsR);
    if (pairKeys.length > 4) {
      const values = [];
      for (let i = 0; i < pairKeys.length; i++) values.push(S.pairAbsR[pairKeys[i]]);
      values.sort((a, b) => a - b);
      const n = values.length;
      const meanVal = totalEnergy / n;

      if (meanVal > 0.001) {
        let rankSum = 0;
        for (let i = 0; i < n; i++) {
          rankSum += (i + 1) * values[i];
        }
        S.giniCoefficient = (2 * rankSum) / (n * totalEnergy) - (n + 1) / n;
        S.giniCoefficient = clamp(S.giniCoefficient, 0, 1);
      }
    }

    S.refreshedThisTick = true;
    homeostasisTick.tick();

    // Diagnostics
    explainabilityBus.emit('COUPLING_HOMEOSTASIS', 'both', {
      totalEnergy: Number(totalEnergy.toFixed(3)),
      ema: Number(S.totalEnergyEma.toFixed(3)),
      budget: Number(S.energyBudget.toFixed(3)),
      peak: Number(S.peakEnergyEma.toFixed(3)),
      redistribution: Number(S.redistributionScore.toFixed(3)),
      multiplier: Number(S.globalGainMultiplier.toFixed(3)),
      gini: Number(S.giniCoefficient.toFixed(3)),
      energyDeltaEma: Number(S.energyDeltaEma.toFixed(4)),
      pairTurbulenceEma: Number(S.pairTurbulenceEma.toFixed(4)),
      overBudget: S.overBudget,
      pairs: pairCount
    });
  }

  return { refresh };
})();
