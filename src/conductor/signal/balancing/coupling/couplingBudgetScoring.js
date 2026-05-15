

/**
 * Coupling Budget Scoring
 *
 * Computes budget priority scores for each nudgeable pair when the
 * homeostasis budget constraint is active. Ranks pairs by combined
 * pressure metrics and assigns gain boosts. Updates couplingState
 * budgetPriority* fields.
 */

moduleLifecycle.declare({
  name: 'couplingBudgetScoring',
  subsystem: 'conductor',
  deps: ['validator'],
  lazyDeps: ['couplingConstants', 'couplingState', 'pipelineCouplingManagerSnapshot'],
  provides: ['couplingBudgetScoring'],
  init: (deps) => {
  const V = deps.validator.create('couplingBudgetScoring');
  const { ALL_MONITORED_DIMS, NON_NUDGEABLE_SET,
    BUDGET_PRIORITY_GAIN, BUDGET_DEPRIORITIZED_GAIN, BUDGET_PRIORITY_TOP_K } = couplingConstants;
  const getPairTailTelemetry = pipelineCouplingManagerSnapshot.getPairTailTelemetry;
  // R78 E3: Track consecutive zero-effectiveGain beats per pair
  const zeroGainStreaks = {};

  /**
   * Compute budget priority scores and assign gain boosts.
   * @param {object} setup - setup context from couplingRefreshSetup
   */
  function compute(setup) {
    const S = couplingState;
    const matrix = setup.matrix;
    S.budgetPriorityScore = {};
    S.budgetPriorityBoost = {};
    S.budgetPriorityRank = {};

    /** @type {Array<{ key: string, score: number, boost: number }>} */
    const rankedPairs = [];
    for (let a = 0; a < ALL_MONITORED_DIMS.length; a++) {
      for (let b = a + 1; b < ALL_MONITORED_DIMS.length; b++) {
        const dimA = ALL_MONITORED_DIMS[a];
        const dimB = ALL_MONITORED_DIMS[b];
        const key = dimA + '-' + dimB;
        if (NON_NUDGEABLE_SET.has(key)) continue;
        const flags = couplingConstants.classifyPair(key, dimA, dimB);
        const { isDensityFlickerPair, isFlickerTrustPair, isTensionPhasePair, isDensityTrustPair, isDensityTensionPair, isTensionEntropyPair, isEntropySurfacePair, isTrustPair, isPhasePair } = flags;
        const corr = matrix[key];
        if (!V.optionalType(corr, 'number') || V.optionalFinite(corr) === undefined) continue;
        const absCorr = m.abs(corr);
        // R66 E3: Use phaseTargetScale for phase pairs
        const pairTargetScale = isPhasePair && setup.phaseTargetScale !== undefined
          ? setup.phaseTargetScale
          : setup.targetScale;
        const target = S.getTarget(key) * pairTargetScale;
        const ps = S.getPairState(key);
        const tailTelemetry = getPairTailTelemetry(ps);
        const p95 = tailTelemetry.p95;
        const hotspotRate = tailTelemetry.hotspotRate;
        const severeRate = tailTelemetry.severeRate;
        const previousEffectiveGain = V.optionalFinite(ps.lastEffectiveGain, 0);
        // Track consecutive near-zero-effectiveGain beats per pair.
        if (previousEffectiveGain < 0.01 && absCorr > target) {
          zeroGainStreaks[key] = (V.optionalFinite(zeroGainStreaks[key], 0)) + 1;
        } else if (previousEffectiveGain >= 0.01) {
          zeroGainStreaks[key] = 0;
        }
        const gainBase = m.max(ps.gain, couplingConstants.GAIN_INIT);
        const effectiveShortfall = clamp((gainBase - m.min(gainBase, previousEffectiveGain)) / gainBase, 0, 1);
        const exceedPressure = clamp((absCorr - m.max(target, 0.06)) / 0.45, 0, 1);
        const residualP95Pressure = clamp((p95 - m.max(target + 0.22, 0.68)) / 0.16, 0, 1);
        const residualTailPressure = clamp((p95 - m.max(target + 0.18, 0.64)) / 0.14, 0, 1);
        const densityFlickerClampPressure = isDensityFlickerPair
          ? clamp(
            clamp((p95 - 0.90) / 0.08, 0, 1) * 0.40 +
            severeRate * 0.28 + hotspotRate * 0.18 +
            clamp((absCorr - 0.88) / 0.10, 0, 1) * 0.14,
            0, 1)
          : 0;
        const densityFlickerZeroGainPressure = isDensityFlickerPair
          ? clamp(
            clamp((p95 - 0.68) / 0.16, 0, 1) * 0.32 +
            hotspotRate * 0.34 +
            clamp((setup.densityFlickerTailPressure - 0.25) / 0.45, 0, 1) * 0.18 +
            clamp(((V.optionalFinite(zeroGainStreaks[key], 0)) - 6) / 8, 0, 1) * 0.26 +
            (previousEffectiveGain < 0.01 ? 0.12 : 0),
            0, 1)
          : 0;
        // Flicker-trust decorrelation pressure. Structural FT
        const flickerTrustCorrPressure = isFlickerTrustPair
          ? clamp(
            clamp((absCorr - 0.25) / 0.25, 0, 1) * 0.52 +
            hotspotRate * 0.25 + severeRate * 0.20 +
            clamp((p95 - 0.75) / 0.15, 0, 1) * 0.10,
            0, 1)
          : 0;
        // Tension-phase decorrelation pressure. TP r=0.3354
        const tensionPhaseCorrPressure = isTensionPhasePair
          ? clamp(
            clamp((absCorr - 0.30) / 0.30, 0, 1) * 0.40 +
            hotspotRate * 0.25 + severeRate * 0.20 +
            clamp((p95 - 0.70) / 0.20, 0, 1) * 0.15,
            0, 1)
          : 0;
        // Density-trust decorrelation pressure. DT r=0.637
        const densityTrustCorrPressure = isDensityTrustPair
          ? clamp(
            clamp((absCorr - 0.40) / 0.25, 0, 1) * 0.35 +
            hotspotRate * 0.25 + severeRate * 0.20 +
            clamp((p95 - 0.75) / 0.15, 0, 1) * 0.20,
            0, 1)
          : 0;
        // Density-tension decorrelation pressure: penalizes both + and -
        // correlation via absCorr threshold 0.30, coeff 0.40.
        const densityTensionCorrPressure = isDensityTensionPair
          ? clamp(
            clamp((absCorr - 0.30) / 0.25, 0, 1) * 0.40 +
            hotspotRate * 0.20 + severeRate * 0.15 +
            clamp((p95 - 0.70) / 0.20, 0, 1) * 0.15,
            0, 1)
          : 0;
        // Density-flicker decorrelation pressure: tighter target than DT/FT
        // (DF target 0.12); absCorr threshold 0.30, coeff 0.39.
        const densityFlickerCorrPressure = isDensityFlickerPair
          ? clamp(
            clamp((absCorr - 0.30) / 0.25, 0, 1) * 0.39 +
            hotspotRate * 0.20 + severeRate * 0.15 +
            clamp((p95 - 0.65) / 0.20, 0, 1) * 0.15,
            0, 1)
          : 0;
        // Tension-entropy decorrelation pressure. TE r=-0.434
        const tensionEntropyCorrPressure = isTensionEntropyPair
          ? clamp(
            clamp((absCorr - 0.25) / 0.25, 0, 1) * 0.50 +
            hotspotRate * 0.15 + severeRate * 0.15 +
            clamp((p95 - 0.65) / 0.20, 0, 1) * 0.15,
            0, 1)
          : 0;
        // Tension-flicker decorrelation pressure. TF r=-0.321
        const isTensionFlickerPair = (dimA === 'tension' && dimB === 'flicker') || (dimA === 'flicker' && dimB === 'tension');
        const tensionFlickerCorrPressure = isTensionFlickerPair
          ? clamp(
            clamp((absCorr - 0.20) / 0.25, 0, 1) * 0.52 +
            hotspotRate * 0.20 + severeRate * 0.15 +
            clamp((p95 - 0.70) / 0.20, 0, 1) * 0.15,
            0, 1)
          : 0;
        const tensionFlickerMigrationPressure = isTensionFlickerPair
          ? clamp(
            clamp((p95 - 0.80) / 0.12, 0, 1) * 0.36 +
            severeRate * 0.28 + hotspotRate * 0.20 +
            clamp((0.35 - setup.densityFlickerTailPressure) / 0.35, 0, 1) * 0.16,
            0, 1)
          : 0;
        // Entropy-trust decorrelation pressure. ET r=-0.407
        const isEntropyTrustPair = (dimA === 'entropy' && dimB === 'trust') || (dimA === 'trust' && dimB === 'entropy');
        // Lower ET threshold 0.35->0.28.
        const entropyTrustCorrPressure = isEntropyTrustPair
          ? clamp(
            clamp((absCorr - 0.28) / 0.25, 0, 1) * 0.48 +
            hotspotRate * 0.18 + severeRate * 0.15 +
            clamp((p95 - 0.65) / 0.20, 0, 1) * 0.15,
            0, 1)
          : 0;
        const recentP95 = V.optionalFinite(tailTelemetry.recentP95, 0);
        // recent-deterioration bonus. When recentHotspotRate is
        const recentHotspotRate = V.optionalFinite(tailTelemetry.recentHotspotRate, 0);
        const recentDeteriorationBonus = recentHotspotRate > hotspotRate * 2.0 && recentHotspotRate > 0.15
          ? clamp((recentHotspotRate - hotspotRate) / 0.20, 0, 0.5) * 0.18
          : 0;
        const entropySpilloverPressure = isEntropySurfacePair
          ? clamp(
            clamp((p95 - 0.78) / 0.14, 0, 1) * 0.40 +
            hotspotRate * 0.20 + severeRate * 0.20 +
            clamp((absCorr - 0.72) / 0.16, 0, 1) * 0.20,
            0, 1)
          : 0;
        // Entropy-surface severe uplift. When an entropy-surface pair
        const entropySevereUplift = isEntropySurfacePair && p95 > 0.80 && severeRate > 0.06
          ? clamp((p95 - 0.80) / 0.12, 0, 1) * 0.35 + clamp(severeRate / 0.15, 0, 1) * 0.25
          : 0;
        const nonNudgeableHandOffPressure = setup.nonNudgeableTailPressure > 0 && couplingConstants.sharesAnyAxis(key, setup.nonNudgeableAxes)
          ? clamp(
            setup.nonNudgeableTailPressure * (isEntropySurfacePair ? 0.90 : (isPhasePair || isTrustPair ? 0.72 : 0.55)) +
            setup.entropyAxisPressure * (isEntropySurfacePair ? 0.24 : 0.08),
            0, 1.2)
          : 0;
        const tailPressure = setup.tailPressureByPair && typeof setup.tailPressureByPair[key] === 'number'
          ? clamp(setup.tailPressureByPair[key], 0, 1) : 0;
        const trustReconciliationPressure = isTrustPair
          ? clamp(
            clamp((p95 - m.max(target + 0.16, 0.68)) / 0.18, 0, 1) * 0.22 +
            clamp((p95 - recentP95 - 0.08) / 0.18, 0, 1) * 0.48 +
            hotspotRate * 0.15 + severeRate * 0.15,
            0, 1.1)
          : 0;
        const recentSevere = V.optionalFinite(tailTelemetry.recentSevereRate, 0);
        const severeWindowPressure = (recentSevere > 0.50 && tailPressure > 0.40)
          ? clamp(recentSevere * 0.55 + tailPressure * 0.35 + clamp((p95 - 0.85) / 0.12, 0, 1) * 0.30, 0, 1.2) : 0;
        const staticBias = BUDGET_PRIORITY_GAIN[key] !== undefined
          ? clamp((BUDGET_PRIORITY_GAIN[key] - 1.0) / 0.60, 0, 1) : 0;
        const telemetryGapPressure = clamp((p95 - recentP95 - 0.10) / 0.20, 0, 0.5);
        const score = clamp(
          residualTailPressure * 0.18 + tailPressure * (0.15 + setup.tailRecoveryHandshake * 0.08) +
          clamp(V.optionalFinite(ps.heatPenalty, 0), 0, 1) * 0.12 + severeRate * 0.10 + hotspotRate * 0.08 +
          residualP95Pressure * 0.10 + densityFlickerClampPressure * 0.18 +
          densityFlickerZeroGainPressure * 0.18 +
          flickerTrustCorrPressure * 0.25 +
          tensionPhaseCorrPressure * 0.18 +
          densityTrustCorrPressure * 0.18 +
          densityTensionCorrPressure * 0.15 +
          densityFlickerCorrPressure * 0.22 +
          tensionEntropyCorrPressure * 0.16 +
          tensionFlickerCorrPressure * 0.28 +
          tensionFlickerMigrationPressure * 0.18 +
          entropyTrustCorrPressure * 0.18 +
          entropySpilloverPressure * 0.16 + entropySevereUplift * 0.20 +
          trustReconciliationPressure * 0.22 +
          setup.entropyAxisPressure * (isEntropySurfacePair ? 0.18 : 0.04) +
          nonNudgeableHandOffPressure * 0.16 + effectiveShortfall * 0.08 +
          exceedPressure * 0.08 + clamp(setup.tailRecoveryHandshake * tailPressure, 0, 1) * 0.10 +
          severeWindowPressure * 0.22 + telemetryGapPressure * 0.14 + staticBias * 0.04 +
          recentDeteriorationBonus,
          0, 1.45);
        // R72 E4: Phase-pair budget floor
        let budgetScore = (isPhasePair && p95 > 0.60 && hotspotRate > 0.01) ? m.max(score, 0.08) : score;
        // Temporal discount. When recent tail has cooled well below
        if (recentP95 > 0 && p95 > 0 && recentP95 < p95 * 0.60) {
          budgetScore = m.max(budgetScore - 0.10, 0);
        }
        if (budgetScore > 0.04) {
          rankedPairs.push({
            key, score: budgetScore,
            boost: 1 + clamp(budgetScore + densityFlickerClampPressure * 0.60 + entropySpilloverPressure * 0.40 +
              densityFlickerZeroGainPressure * 0.50 +
              entropySevereUplift * 0.35 +
              flickerTrustCorrPressure * 0.60 +
              tensionPhaseCorrPressure * 0.40 +
              densityTrustCorrPressure * 0.40 +
              densityTensionCorrPressure * 0.35 +
              densityFlickerCorrPressure * 0.50 +
              tensionEntropyCorrPressure * 0.40 +
              tensionFlickerCorrPressure * 0.65 +
              tensionFlickerMigrationPressure * 0.45 +
              entropyTrustCorrPressure * 0.48 +
              trustReconciliationPressure * 0.40 +
              nonNudgeableHandOffPressure * 0.45 + setup.entropyAxisPressure * (isEntropySurfacePair ? 0.50 : 0.15) +
              severeWindowPressure * 0.50, 0, 1.6) * 0.28,
          });
        }
      }
    }
    rankedPairs.sort(function(a, b) { return b.score !== a.score ? b.score - a.score : (a.key < b.key ? -1 : 1); });

    // Axis-dominant exceedance budget uplift
    const topK = m.min(BUDGET_PRIORITY_TOP_K, rankedPairs.length);
    /** @type {Record<string, number>} */
    const axisBudgetDominance = {};
    for (let ti = 0; ti < topK; ti++) {
      const dims = rankedPairs[ti].key.split('-');
      for (let di = 0; di < dims.length; di++) {
        axisBudgetDominance[dims[di]] = (axisBudgetDominance[dims[di]] ?? 0) + 1;
      }
    }
    /** @type {string | null} */
    let dominantBudgetAxis = null;
    let dominantBudgetAxisCount = 0;
    const abdKeys = Object.keys(axisBudgetDominance);
    for (let ai = 0; ai < abdKeys.length; ai++) {
      if (axisBudgetDominance[abdKeys[ai]] >= 3 && axisBudgetDominance[abdKeys[ai]] > dominantBudgetAxisCount) {
        dominantBudgetAxis = abdKeys[ai];
        dominantBudgetAxisCount = axisBudgetDominance[abdKeys[ai]];
      }
    }

    for (let i = 0; i < rankedPairs.length; i++) {
      const entry = rankedPairs[i];
      S.budgetPriorityScore[entry.key] = Number(entry.score.toFixed(4));
      const staticBoost = BUDGET_PRIORITY_GAIN[entry.key] !== undefined
        ? 1 + (BUDGET_PRIORITY_GAIN[entry.key] - 1.0) * 0.35
        : BUDGET_DEPRIORITIZED_GAIN;
      const axisDominanceBoost = dominantBudgetAxis && entry.key.indexOf(dominantBudgetAxis) !== -1
        ? 1 + (dominantBudgetAxisCount - 2) * 0.12
        : 1.0;
      // Decay budget boost for prolonged zero-effectiveGain pairs.
      const zgs = V.optionalFinite(zeroGainStreaks[entry.key], 0);
      const zeroGainDecay = zgs > 10 ? m.max(m.pow(0.95, zgs - 10), 0.5) : 1;
      if (i < BUDGET_PRIORITY_TOP_K) {
        const rankBoost = i === 0 ? 1.68 : i === 1 ? 1.54 : i === 2 ? 1.40 : i === 3 ? 1.26 : 1.18;
        S.budgetPriorityBoost[entry.key] = Number((m.max(staticBoost, rankBoost, entry.boost) * axisDominanceBoost * zeroGainDecay).toFixed(4));
        S.budgetPriorityRank[entry.key] = i + 1;
      } else {
        S.budgetPriorityBoost[entry.key] = Number((staticBoost * axisDominanceBoost * zeroGainDecay).toFixed(4));
      }
    }
  }

  return { compute };
  },
});
