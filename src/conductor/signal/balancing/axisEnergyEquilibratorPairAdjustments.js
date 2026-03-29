axisEnergyEquilibratorPairAdjustments = (() => {
  // R19 E4: Axis-aware giniMult dampening. Compute dominant axis from
  // energy shares so giniMult preferentially targets pairs involving the
  // dominant axis, protecting non-dominant axes from over-tightening.
  // When flicker is dominant (0.219), flicker pairs feel full giniMult
  // while tension pairs (non-dominant) get dampened giniMult, preserving
  // tension peaks. Factor: pairs with 0 dominant axes get 0.5x giniMult
  // excess; pairs with 1 get 0.75x; pairs with 2 get full 1.0x.
  // R19 E4: Axis-aware giniMult dampening.
  // R20 E3: GINI_DAMPEN_0 raised 0.5->0.65. Non-dominant-axis pairs
  // were getting only 50% of giniMult excess, allowing density-entropy
  // correlation (r=0.51) to build unchecked. 65% provides more corrective
  // pressure on non-dominant pairs while still prioritizing dominant axis.
  const GINI_DAMPEN_0 = 0.65;
  const GINI_DAMPEN_1 = 0.75;

  function getDominantAxes(shares) {
    if (!shares) return [];
    let maxShare = 0;
    let secondShare = 0;
    let maxAxis = '';
    let secondAxis = '';
    const axes = Object.keys(shares);
    for (let i = 0; i < axes.length; i++) {
      const s = shares[axes[i]];
      if (typeof s === 'number' && s > maxShare) {
        secondShare = maxShare;
        secondAxis = maxAxis;
        maxShare = s;
        maxAxis = axes[i];
      } else if (typeof s === 'number' && s > secondShare) {
        secondShare = s;
        secondAxis = axes[i];
      }
    }
    // Only count an axis as "dominant" if it exceeds fair share (1/6 ~ 0.167)
    const result = [];
    if (maxAxis && maxShare > 0.167) result.push(maxAxis);
    if (secondAxis && secondShare > 0.167) result.push(secondAxis);
    return result;
  }

  function apply(state, config, context, V) {
    for (let i = 0; i < config.ALL_PAIRS.length; i++) {
      const pair = config.ALL_PAIRS[i];
      if ((V.optionalFinite(state.pairCooldowns[pair], 0)) > 0) continue;
      const pairData = context.snapshot[pair];
      if (!pairData) continue;

      const baseline = V.optionalFinite(pairData.baseline);
      const rolling = V.optionalFinite(pairData.rawRollingAbsCorr);
      if (baseline === undefined || rolling === undefined) continue;

      const pairP95 = V.optionalFinite(pairData.p95AbsCorr, rolling);
      const hotspotRate = V.optionalFinite(pairData.hotspotRate, 0);
      const severeRate = V.optionalFinite(pairData.severeRate, 0);
      const residualPressure = V.optionalFinite(pairData.residualPressure, 0);
      const budgetRank = V.optionalFinite(pairData.budgetRank, 99);
      const residualTailHot = pairP95 > m.max(config.RESIDUAL_P95_ABS_MIN, baseline * config.RESIDUAL_P95_RATIO)
        || hotspotRate > config.RESIDUAL_HOTSPOT_RATE
        || severeRate > config.RESIDUAL_SEVERE_RATE
        || residualPressure > 0.28;

      const isPhaseSurfacePair = config.PHASE_SURFACE_SET.has(pair);
      const isTrustSurfacePair = config.TRUST_SURFACE_SET.has(pair);
      const isEntropySurfacePair = config.ENTROPY_SURFACE_SET.has(pair);
      const coherentPairEligible = isPhaseSurfacePair || isTrustSurfacePair || isEntropySurfacePair || pair === 'density-flicker';
      const pairTightenScale = context.currentRegime === 'coherent'
        ? (coherentPairEligible && (residualTailHot || rolling > config.HOTSPOT_RATIO * baseline) ? context.coherentHotspotScale : 0)
        : context.tightenScale;

      if (pairTightenScale > 0 && ((rolling > config.HOTSPOT_RATIO * baseline && rolling > config.HOTSPOT_ABS_MIN) || residualTailHot)) {
        const overshoot = m.max(rolling / m.max(baseline, 0.01), pairP95 / m.max(baseline, 0.01));
        const residualTightenPressure = clamp(
          clamp((pairP95 - m.max(config.RESIDUAL_P95_ABS_MIN, baseline * config.RESIDUAL_P95_RATIO)) / 0.18, 0, 1) * 0.55 +
          clamp((hotspotRate - config.RESIDUAL_HOTSPOT_RATE) / 0.20, 0, 1) * 0.25 +
          clamp((severeRate - config.RESIDUAL_SEVERE_RATE) / 0.12, 0, 1) * 0.20,
          0,
          1
        );
        const phaseSurfaceBoost = isPhaseSurfacePair ? 1.35 : 1.0;
        const flickerPhaseBoost = pair === 'flicker-phase' && residualPressure > 0.7 ? 1 + (residualPressure - 0.7) * 1.5 : 1.0;
        const entropySurfaceBoost = isEntropySurfacePair ? 1.28 : 1.0;
        const rankBoost = budgetRank <= 1 ? 1.30 : budgetRank <= 3 ? 1.16 : 1.0;
        const coherentHotBoost = context.currentRegime === 'coherent' && coherentPairEligible ? (isEntropySurfacePair ? 1.18 : 1.10) : 1.0;
        const shortRunHandOffBoost = context.recoveryAxisHandOffPressure > 0 && context.densityFlickerAxisLock && (pair === 'density-flicker' || isPhaseSurfacePair)
          ? 1 + context.recoveryAxisHandOffPressure * (0.22 + context.shortRunRecoveryBias * 0.25)
          : 1.0;
        const nonNudgeableHandOffBoost = context.nonNudgeableTailPressure > 0 && !config.NON_NUDGEABLE_TAIL_SET.has(pair) && context.nonNudgeableAxes.length > 0 && (
          pair.indexOf(context.nonNudgeableAxes[0]) !== -1 || (context.nonNudgeableAxes[1] && pair.indexOf(context.nonNudgeableAxes[1]) !== -1)
        )
          ? 1 + context.nonNudgeableTailPressure * (isEntropySurfacePair ? 0.70 : (isPhaseSurfacePair || isTrustSurfacePair ? 0.52 : 0.32))
          : 1.0;
        // R19 E4: Axis-aware giniMult dampening. Only apply full giniMult
        // excess to pairs involving the dominant axis. Non-dominant pairs
        // get dampened giniMult to preserve their signal headroom (e.g.
        // tension peaks when flicker is dominant).
        const domAxes = getDominantAxes(context.shares);
        let pairGiniMult = context.giniMult;
        if (domAxes.length > 0 && pairGiniMult > 1.0) {
          const pairParts = pair.split('-');
          let domCount = 0;
          for (let d = 0; d < domAxes.length; d++) {
            if (pairParts[0] === domAxes[d] || pairParts[1] === domAxes[d]) domCount++;
          }
          const dampen = domCount >= 2 ? 1.0 : domCount === 1 ? GINI_DAMPEN_1 : GINI_DAMPEN_0;
          pairGiniMult = 1.0 + (pairGiniMult - 1.0) * dampen;
        }
        const rate = config.PAIR_TIGHTEN_RATE * pairTightenScale * pairGiniMult * phaseSurfaceBoost * flickerPhaseBoost * entropySurfaceBoost * rankBoost * coherentHotBoost * shortRunHandOffBoost * nonNudgeableHandOffBoost * (1 + residualTightenPressure * config.RESIDUAL_TIGHTEN_BONUS) * clamp(overshoot - config.HOTSPOT_RATIO, 0.5, 3.0);
        const nextBaseline = m.max(pair === 'density-flicker' ? config.DENSITY_FLICKER_BASELINE_MIN : config.BASELINE_MIN, baseline - rate);
        if (nextBaseline < baseline) {
          pipelineCouplingManager.setPairBaseline(pair, nextBaseline);
          state.pairCooldowns[pair] = config.PAIR_COOLDOWN;
          state.pairAdjustments++;
          if (context.currentRegime === 'coherent' && pairTightenScale > 0) state.coherentHotspotPairAdj++;
          state.perPairAdj[pair] = (V.optionalFinite(state.perPairAdj[pair], 0)) + 1;
          state.regimePairAdj[context.regimeKey] = (state.regimePairAdj[context.regimeKey] || 0) + 1;
        }
      } else if (rolling < config.COLDSPOT_RATIO * baseline && rolling < config.COLDSPOT_ABS_MAX) {
        if (context.coherentColdspotFreeze || pairP95 > config.RESIDUAL_COLDSPOT_P95_MAX || hotspotRate > 0.06 || severeRate > 0.02) {
          state.skippedColdspotRelaxations++;
          if (context.coherentColdspotFreeze) state.coldspotSkipReasons.coherentFreeze++;
          else state.coldspotSkipReasons.residual++;
          continue;
        }
        const nextBaseline = m.min(config.BASELINE_MAX, baseline + config.PAIR_RELAX_RATE);
        if (nextBaseline > baseline) {
          pipelineCouplingManager.setPairBaseline(pair, nextBaseline);
          state.pairCooldowns[pair] = config.PAIR_COOLDOWN;
          state.pairAdjustments++;
          state.perPairAdj[pair] = (V.optionalFinite(state.perPairAdj[pair], 0)) + 1;
          state.regimePairAdj[context.regimeKey] = (state.regimePairAdj[context.regimeKey] || 0) + 1;
        }
      }
    }
  }

  return { apply };
})();
