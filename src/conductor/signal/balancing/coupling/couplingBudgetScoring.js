

/**
 * Coupling Budget Scoring
 *
 * Computes budget priority scores for each nudgeable pair when the
 * homeostasis budget constraint is active. Ranks pairs by combined
 * pressure metrics and assigns gain boosts. Updates couplingState
 * budgetPriority* fields.
 */

couplingBudgetScoring = (() => {
  const V = validator.create('couplingBudgetScoring');
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
        // R78 E3: Track consecutive near-zero-effectiveGain beats per pair.
        // Pairs with zeroed gain (density-flicker, flicker-trust) waste
        // budget slots. Decay their boost after 10 consecutive zero beats.
        // R79 E1: Near-zero threshold (was === 0, but modifier chain
        // produces small positive values that never hit exact zero).
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
        // R24 E1: Flicker-trust decorrelation pressure. Structural FT
        // correlation r~0.56 resists regime-level brakes. Elevate FT
        // budget priority when the pair shows persistent positive corr,
        // driving gain escalation to actively dampen the correlation.
        // R42 E2: Lower FT threshold 0.35->0.25. FT reversed to +0.184
        // in R41. Many per-beat samples fall below old 0.35 threshold.
        // R49 E2: Boost FT coefficient 0.45->0.52. FT surged to +0.335
        // in R48. The threshold 0.25 is correct but needs stronger
        // penalization to drive decorrelation.
        const flickerTrustCorrPressure = isFlickerTrustPair
          ? clamp(
            clamp((absCorr - 0.25) / 0.25, 0, 1) * 0.52 +
            hotspotRate * 0.25 + severeRate * 0.20 +
            clamp((p95 - 0.75) / 0.15, 0, 1) * 0.10,
            0, 1)
          : 0;
        // R26 E1: Tension-phase decorrelation pressure. TP r=0.3354
        // trending increasing. Same proven pattern as R24 FT fix:
        // elevate TP budget priority when pair shows persistent
        // positive correlation, driving gain escalation to dampen it.
        const tensionPhaseCorrPressure = isTensionPhasePair
          ? clamp(
            clamp((absCorr - 0.30) / 0.30, 0, 1) * 0.40 +
            hotspotRate * 0.25 + severeRate * 0.20 +
            clamp((p95 - 0.70) / 0.20, 0, 1) * 0.15,
            0, 1)
          : 0;
        // R29 E1: Density-trust decorrelation pressure. DT r=0.637
        // trending increasing. Same proven pattern as R24 FT and R26 TP:
        // elevate DT budget priority when pair shows persistent positive
        // correlation, driving gain escalation to dampen it.
        const densityTrustCorrPressure = isDensityTrustPair
          ? clamp(
            clamp((absCorr - 0.40) / 0.25, 0, 1) * 0.35 +
            hotspotRate * 0.25 + severeRate * 0.20 +
            clamp((p95 - 0.75) / 0.15, 0, 1) * 0.20,
            0, 1)
          : 0;
        // R32 E1: Density-tension decorrelation pressure. DT r=-0.562
        // trending "decreasing" (strong anti-correlation). Same budget
        // scoring pattern, using absCorr to penalize both + and - correlation.
        // R44 E2: Reduce DT pressure (0.35->0.25, 0.35->0.40).
        // R46 E1: Moderate re-strengthen (coeff 0.30, threshold 0.38).
        // R48 E1: Further re-strengthen. DT still at -0.527. Raise coeff
        // 0.30->0.35 and lower threshold 0.38->0.35 to give budget scoring
        // more teeth against persistent DT anti-correlation.
        // R56 E3: Lower DT threshold 0.35->0.30. DT at -0.555 in R55
        // with rollingAbsCorr potentially below 0.35 threshold, preventing
        // budget engagement.
        // R57 E2: Boost DT coeff 0.35->0.40. DT stuck at -0.55 despite
        // threshold fix. More decorrelation force needed.
        // R59 E3: Raise DT coeff 0.40->0.42. R58 regressed DT from the
        // R57 near-best zone back to -0.339 while tail pressure dispersed.
        // R60 E1: Revert 0.42->0.40. The extra boost was refuted in R59,
        // driving DT to -0.602.
        const densityTensionCorrPressure = isDensityTensionPair
          ? clamp(
            clamp((absCorr - 0.30) / 0.25, 0, 1) * 0.40 +
            hotspotRate * 0.20 + severeRate * 0.15 +
            clamp((p95 - 0.70) / 0.20, 0, 1) * 0.15,
            0, 1)
          : 0;
        // R34 E1: Density-flicker decorrelation pressure. DF r=0.367
        // "increasing" in R33, driving flicker axis surge (0.170->0.230).
        // Same budget scoring pattern. absCorr threshold 0.30 (lower than
        // DT/FT since DF target is 0.12 -- tighter coupling target).
        // R42 E1: Boost DF pressure -- DF exploded -0.136->+0.363 in R41.
        // R48 E2: Reduce DF pressure. DF overcorrected to -0.248 in R47.
        // Lower coefficient 0.40->0.32 to reduce overcorrection.
        // R55 E2: Boost DF coefficient 0.38->0.44. DF flipped to +0.306 in
        // R54 with budgetRank 2. Needs stronger decorrelation force.
        // R56 E1: Moderate DF coefficient 0.44->0.40. R55 overcorrected DF
        // from +0.306 to -0.309. Split the difference to center near zero.
        // R57 E4: Fine-tune DF coeff 0.40->0.41. DF at +0.234 (R56), still
        // slightly positive. Nudge coefficient up 0.01 to push toward zero.
        // R58 E2: Back DF coeff off 0.41->0.39. R57 centered DF correlation
        // (+0.081) but DF tail pressure exploded to 51 exceedance beats.
        // The remaining problem is magnitude, not correlation direction.
        const densityFlickerCorrPressure = isDensityFlickerPair
          ? clamp(
            clamp((absCorr - 0.30) / 0.25, 0, 1) * 0.39 +
            hotspotRate * 0.20 + severeRate * 0.15 +
            clamp((p95 - 0.65) / 0.20, 0, 1) * 0.15,
            0, 1)
          : 0;
        // R35 E3: Tension-entropy decorrelation pressure. TE r=-0.434
        // "decreasing" in R34. Entropy axis at 0.122 (27% below fair
        // share). Anti-correlation suppresses entropy when tension is high.
        // R47 E2: Boost TE pressure. TE surged to -0.492 in R46.
        // Lower threshold 0.35->0.30, raise coefficient 0.30->0.40.
        // R52 E3: Boost TE coefficient. TE collapsed to -0.413 in R51.
        // R55 E1: Lower TE threshold 0.30->0.25. In R54 TE rollingAbsCorr
        // was 0.2848 -- just below 0.30 -- so budget scoring never activated.
        // This left TE at -0.294 with zero budget pressure. Lowering to 0.25
        // ensures engagement.
        // R58 E3: Raise TE coeff 0.46->0.50. R57 regressed to -0.239 after
        // the R56 near-best +0.145 run, so TE still needs more force.
        const tensionEntropyCorrPressure = isTensionEntropyPair
          ? clamp(
            clamp((absCorr - 0.25) / 0.25, 0, 1) * 0.50 +
            hotspotRate * 0.15 + severeRate * 0.15 +
            clamp((p95 - 0.65) / 0.20, 0, 1) * 0.15,
            0, 1)
          : 0;
        // R37 E2: Tension-flicker decorrelation pressure. TF r=-0.321
        // "decreasing" in R36. New anti-correlation pair emerging.
        // Budget scoring to preempt entrenchment.
        // R43 E1: Boost TF pressure. TF worsened -0.104 -> -0.395 in R42.
        // R45 E1: Heavy TF boost. TF now -0.422 (3rd consecutive worsening).
        // Lower threshold 0.30->0.20, raise coefficient 0.40->0.50.
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
        // R38 E2: Entropy-trust decorrelation pressure. ET r=-0.407
        // "decreasing" in R37. New anti-correlation pair from TE cap
        // spillover. Budget scoring to preempt. absCorr threshold 0.35.
        const isEntropyTrustPair = (dimA === 'entropy' && dimB === 'trust') || (dimA === 'trust' && dimB === 'entropy');
        // R42 E5: Lower ET threshold 0.35->0.28.
        // R46 E3: Boost ET pressure. ET worsened to -0.373 in R45.
        // Raise coefficient 0.28->0.35 for stronger decorrelation.
        // R56 E2: Boost ET coeff 0.42->0.48. ET plunged -0.143->-0.443
        // in R55. Budget needs more force.
        const entropyTrustCorrPressure = isEntropyTrustPair
          ? clamp(
            clamp((absCorr - 0.28) / 0.25, 0, 1) * 0.48 +
            hotspotRate * 0.18 + severeRate * 0.15 +
            clamp((p95 - 0.65) / 0.20, 0, 1) * 0.15,
            0, 1)
          : 0;
        const recentP95 = V.optionalFinite(tailTelemetry.recentP95, 0);
        // R82 E2: recent-deterioration bonus. When recentHotspotRate is
        // worsening relative to overall hotspotRate, the pair is actively
        // deteriorating and needs higher budget priority.
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
        // R73 E2: Entropy-surface severe uplift. When an entropy-surface pair
        // has persistent severe tail (p95 > 0.80, severeRate > 0.06), boost
        // its spillover pressure to elevate budget priority. Breaks entropy-
        // axis concentration monopoly on severe pairs.
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
        // R82 E6: Temporal discount. When recent tail has cooled well below
        // lifetime p95, the pair no longer needs aggressive budget priority.
        // Prevent stale scoring from keeping gain maxed on recovered pairs.
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
        axisBudgetDominance[dims[di]] = (axisBudgetDominance[dims[di]] || 0) + 1;
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
      // R78 E3: Decay budget boost for prolonged zero-effectiveGain pairs.
      // After 10 consecutive zero-gain beats, decay by 0.95^(count-10),
      // floored at 0.5. Frees budget from density-flicker/flicker-trust.
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
})();
