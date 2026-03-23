

/**
 * Coupling Effective Gain
 *
 * Per-pair surface pressure computation, effective gain modifier chain,
 * and nudge emission. Transforms the base gain from couplingGainEscalation
 * into final nudge magnitudes applied to density/tension/flicker axes.
 */

couplingEffectiveGain = (() => {
  const { NUDGEABLE_SET, BUDGET_PRIORITY_GAIN, BUDGET_DEPRIORITIZED_GAIN,
    VELOCITY_GAIN_BOOST } = couplingConstants;

  /**
   * Compute per-pair surface pressures and return adjusted target.
   * Must be called before processGain since nonNudgeableHandOffPressure
   * is consumed by gain escalation.
   */
  function computeSurfacePressures(key, absCorr, p95, tailTelemetry, target0, setup, flags) {
    const nonNudgeableHandOffPressure = !flags.isNonNudgeablePair && setup.nonNudgeableTailPressure > 0 &&
        couplingConstants.sharesAnyAxis(key, setup.nonNudgeableAxes)
      ? clamp(
        setup.nonNudgeableTailPressure * (flags.isEntropySurfacePair ? 0.95 : (flags.isPhaseSurfacePair || flags.isTrustPair ? 0.78 : 0.56)) +
        setup.entropyAxisPressure * (flags.isEntropySurfacePair ? 0.30 : 0),
        0, 1.25)
      : 0;
    const tailPressure = setup.tailPressureByPair && typeof setup.tailPressureByPair[key] === 'number'
      ? clamp(setup.tailPressureByPair[key], 0, 1) : 0;
    const coherentSurfacePressure = setup.regime === 'coherent'
      ? clamp(
        // R25 E2: Floor of 0.08 ensures phase surface pairs always receive some
        // coherent pressure even when p95 < 0.82 (common in coherent regime).
        (flags.isPhaseSurfacePair ? m.max(0.08, clamp((p95 - 0.82) / 0.14, 0, 1) * 0.55) + tailTelemetry.hotspotRate * 0.20 : 0) +
        (flags.isTrustPair ? clamp((p95 - 0.80) / 0.16, 0, 1) * 0.45 + tailTelemetry.severeRate * 0.18 : 0) +
        (flags.isDensityFlickerPair ? clamp((p95 - 0.88) / 0.10, 0, 1) * 0.25 + tailPressure * 0.10 : 0),
        0, 1)
      : 0;
    const entropySurfacePressure = flags.isEntropySurfacePair
      ? clamp(
        clamp((p95 - 0.78) / 0.14, 0, 1) * 0.45 + tailTelemetry.hotspotRate * 0.20 +
        tailTelemetry.severeRate * 0.20 + clamp((absCorr - 0.72) / 0.16, 0, 1) * 0.15,
        0, 1)
      : 0;
    const trustSurfacePressure = flags.isTrustPair
      ? clamp(
        clamp((p95 - 0.74) / 0.16, 0, 1) * 0.28 +
        clamp((absCorr - 0.70) / 0.18, 0, 1) * 0.12 +
        tailTelemetry.hotspotRate * 0.20 +
        tailTelemetry.severeRate * 0.12 +
        clamp((p95 - (tailTelemetry.recentP95 || 0) - 0.08) / 0.18, 0, 1) * 0.28,
        0, 1.05)
      : 0;

    // Target adjustment for surface pressure
    let adjustedTarget = target0;
    if ((coherentSurfacePressure > 0 || entropySurfacePressure > 0 || trustSurfacePressure > 0 || nonNudgeableHandOffPressure > 0) && setup.targetScale > 1.0) {
      const baseTarget = couplingState.getTarget(key);
      const surfacePressure = m.max(coherentSurfacePressure, entropySurfacePressure, trustSurfacePressure, nonNudgeableHandOffPressure);
      const reducedRelaxScale = 1 + (setup.targetScale - 1.0) * m.max(0.15, 1 - surfacePressure * 0.85);
      adjustedTarget = baseTarget * reducedRelaxScale;
    }

    // R73 E6: Reconciliation gap pressure. When telemetry p95 diverges from
    // recent p95 by more than 0.15 (the gap observed in density-flicker 0.406),
    // inject additional surface pressure to amplify decorrelation effort on
    // the stale-window tail contribution.
    const recentP95 = tailTelemetry.recentP95 || 0;
    const reconciliationGap = m.max(0, p95 - recentP95 - 0.15);
    const gapPressure = flags.isTrustPair
      ? clamp(reconciliationGap * 1.9 + clamp((p95 - 0.70) / 0.18, 0, 1) * 0.10, 0, 0.70)
      : clamp(reconciliationGap * 1.5, 0, 0.50);

    return {
      adjustedTarget,
      coherentSurfacePressure,
      entropySurfacePressure,
      trustSurfacePressure,
      nonNudgeableHandOffPressure,
      tailPressure,
      gapPressure,
    };
  }

  /**
   * Compute effective gain chain and emit nudges for one pair.
   * Only called when absCorr > target (above-target pairs).
   */
  function computeAndNudge(key, dimA, dimB, corr, absCorr, target, ps, tailTelemetry, setup, flags, sp, axisGainScale, addNudge) {
    const S = couplingState;
    const aIsNudgeable = NUDGEABLE_SET.has(dimA);
    const bIsNudgeable = NUDGEABLE_SET.has(dimB);
    if (!aIsNudgeable && !bIsNudgeable) return;

    const p95 = tailTelemetry.p95;
    const telemetrySevereRate = tailTelemetry.severeRate;

    let effectiveGain = ps.gain * axisGainScale * S.globalGainMultiplier;
    if (dimA === 'flicker' || dimB === 'flicker') effectiveGain *= setup.flickerGainScalar;
    if (dimA === 'density' || dimB === 'density') effectiveGain *= setup.densityGainScalar;
    if (setup.budgetConstraintActive) {
      const budgetFocus = S.budgetPriorityBoost[key] !== undefined
        ? S.budgetPriorityBoost[key]
        : (BUDGET_PRIORITY_GAIN[key] !== undefined
          ? 1 + (BUDGET_PRIORITY_GAIN[key] - 1.0) * 0.35
          : BUDGET_DEPRIORITIZED_GAIN);
      effectiveGain *= 1 + (budgetFocus - 1) * setup.budgetConstraintPressure;
    }
    if (flags.isPhaseSurfacePair && absCorr > target * 1.4) effectiveGain *= 1.18;
    // R79 E2: Phase-pair exceedance gain escalation for persistent hotspots
    if (flags.isPhaseSurfacePair && p95 > 0.85 && sp.tailPressure > 0.40) effectiveGain *= 1 + sp.tailPressure * 0.60;
    if (sp.coherentSurfacePressure > 0) effectiveGain *= 1 + sp.coherentSurfacePressure * 0.45;
    if (flags.isEntropySurfacePair && sp.entropySurfacePressure > 0) effectiveGain *= 1 + sp.entropySurfacePressure * 0.55;
    if (flags.isTrustPair && sp.trustSurfacePressure > 0) effectiveGain *= 1 + sp.trustSurfacePressure * 0.72;
    if (flags.isEntropySurfacePair && setup.entropyAxisPressure > 0) effectiveGain *= 1 + setup.entropyAxisPressure * 0.45;
    if (sp.nonNudgeableHandOffPressure > 0) {
      effectiveGain *= 1 + sp.nonNudgeableHandOffPressure * (flags.isEntropySurfacePair ? 0.85 : 0.60);
    }
    if (flags.isDensityFlickerPair && setup.densityFlickerTailPressure > 0) {
      const densityFlickerClampPressure = clamp(
        setup.densityFlickerTailPressure * 0.75 + clamp((p95 - 0.88) / 0.10, 0, 1) * 0.25 + telemetrySevereRate * 0.30,
        0, 1.4);
      effectiveGain *= 1 + densityFlickerClampPressure * (setup.floorRecoveryActive ? 1.10 : 0.85);
    }
    if (flags.isDensityFlickerPair && setup.densityFlickerOverridePressure > 0) {
      effectiveGain *= 1 + setup.densityFlickerOverridePressure * (setup.floorRecoveryActive ? 1.30 : 0.95);
    }
    if (setup.recoveryAxisHandOffPressure > 0 && (dimA === 'density' || dimA === 'flicker' || dimB === 'density' || dimB === 'flicker')) {
      effectiveGain *= 1 + setup.recoveryAxisHandOffPressure * (0.18 + setup.shortRunRecoveryBias * 0.30);
    }
    if (setup.tailRecoveryHandshake > 0 && sp.tailPressure > 0.03) {
      effectiveGain *= 1 + setup.tailRecoveryHandshake * clamp(sp.tailPressure * 1.25, 0, 1) * 0.75;
    }
    // R73 E6: Gap pressure amplification for reconciliation divergence
    if (sp.gapPressure > 0) {
      effectiveGain *= 1 + sp.gapPressure * (flags.isTrustPair ? 0.95 : 0.60);
    }
    if (S.velocityBoostActive || S.velocityBoostCooldown > 0) effectiveGain *= VELOCITY_GAIN_BOOST;
    // Late-run severe window escalation
    const recentSevereRate = tailTelemetry.recentSevereRate || 0;
    if (recentSevereRate > 0.50 && sp.tailPressure > 0.40) {
      effectiveGain *= 1 + clamp(recentSevereRate * 0.35 + sp.tailPressure * 0.15, 0, 0.50);
    }
    // Anti-correlation dampening
    if (corr < -0.65) {
      const antiCorrDepth = clamp((m.abs(corr) - 0.65) / 0.35, 0, 1);
      const tensionEntropyRelief = flags.isTensionEntropyPair && (p95 > 0.82 || sp.tailPressure > 0.40)
        ? clamp(0.55 + clamp((p95 - 0.82) / 0.12, 0, 1) * 0.12 + sp.tailPressure * 0.16, 0.55, 0.82)
        : 0.15;
      effectiveGain *= m.max(tensionEntropyRelief, 1.0 - antiCorrDepth * 0.80);
    }
    // R76 E1: Structural anti-correlation gain ceiling. When a pair's pearsonR
    // is below -0.80 (strong structural anti-correlation, e.g. density-flicker
    // r=-0.935), cap gain at 0.6x. Anti-correlated pairs represent structural
    // signal -- excessive gain amplifies the lock rather than breaking it.
    if (corr < -0.80) {
      effectiveGain *= 0.6;
    }
    // Positive correlation preemptive brake (R72 E3: graduated)
    if (corr > 0.50) {
      const posCorrDepth = clamp((corr - 0.50) / 0.40, 0, 1);
      const posCorrFloor = (sp.tailPressure > 0.50) ? 0.50 : 0.30;
      effectiveGain *= m.max(posCorrFloor, 1.0 - posCorrDepth * 0.55);
    }
    // R78 E1: Strong positive co-evolution gain ceiling. When pearsonR > 0.80
    // (e.g. tension-flicker r=0.829), the pair is structurally co-evolving.
    // Cap gain at 0.7x to break the lock without eliminating the signal.
    if (corr > 0.80) {
      effectiveGain *= 0.7;
    }
    // R71-R88 + R97 E2: Pair gain ceiling via pairGainCeilingController (#15).
    // Replaces hardcoded per-pair if/else ceiling chains with adaptive ceilings
    // that self-calibrate from rolling p95 EMA and exceedance history.
    // Feed current-beat telemetry to the controller for EMA updates.
    pairGainCeilingController.updatePair(key, p95, tailTelemetry.hotspotRate, telemetrySevereRate);
    const adaptiveCeiling = pairGainCeilingController.getInstantCeiling(key, p95, telemetrySevereRate, tailTelemetry.hotspotRate);
    effectiveGain = m.min(effectiveGain, adaptiveCeiling);
    // R76 E5 + R79 E4: Flicker-trust adaptive target deceleration. When a
    // pair has residual pressure (>0.50) and any upward target drift (>1.01),
    // the decorrelation mechanism is over-investing. Cap effectiveGain at 1.0
    // to prevent runaway target drift. Thresholds relaxed from 0.80/1.20
    // after flicker-trust evaded the original gate (tailP 0.566, drift 1.02).
    if (sp.tailPressure > 0.50 && ps.gain > 0) {
      const at = couplingState.getAdaptiveTarget(key);
      const driftRatio = at.baseline > 0 ? at.current / at.baseline : 1;
      if (driftRatio > 1.01) {
        effectiveGain = m.min(effectiveGain, 1.0);
      }
    }
    // R81-R94 + R97 E3: Section-0 warmup ramp via warmupRampController (#16).
    // Adaptive per-pair ramps derived from historical S0 exceedance and
    // section length. Pairs that spike during S0 get shorter ramps for
    // faster decorrelation; stable pairs get longer ramps for stability.
    const warmupBeats = warmupRampController.getWarmupBeats(key);
    const gbc = couplingState.gateBeatCount;
    if (gbc < warmupBeats) {
      effectiveGain *= gbc / warmupBeats;
      // R2 E1: Tighter ceiling during warmup to reduce section-start exceedance
      const warmupCeiling = warmupRampController.getWarmupCeiling(key, gbc);
      // R5 E2 + R6 E1: Two-tier flicker warmup ceiling. density-flicker gets 0.50x
      // (tightened from 0.60) to target persistent S0 exceedance; other flicker pairs 0.60x.
      const flickerMul = key === 'density-flicker' ? 0.50 : (key.indexOf('flicker') !== -1 ? 0.60 : 1.0);
      effectiveGain = m.min(effectiveGain, warmupCeiling * flickerMul);
      // Feed exceedance data back to the controller
      if (absCorr > target * 1.5) warmupRampController.recordS0Exceedance(key);
    }
    // R80 E2: Universal high-gain safety cap. R79 flicker-trust hit
    // effectiveGain 1.714 (budgetBoost 1.882). Cap all pairs at 1.2 to
    // prevent runaway gain regardless of modifier chain outcome.
    effectiveGain = m.min(effectiveGain, 1.2);
    // R81 E4: Budget-ranked effectiveGain floor. When stacked ceilings
    // zero a pair (density-flicker: anti-corr 0.6x + severe 0.08 = 0),
    // budgetRank 1 priority is wasted on an inert pair. Preserve minimum
    // feedback loop activity for budget-prioritized pairs.
    if (effectiveGain < 0.01 && S.budgetPriorityRank && S.budgetPriorityRank[key] !== undefined) {
      effectiveGain = 0.01;
    }
    ps.lastEffectiveGain = effectiveGain;

    // Nudge emission
    const at = couplingState.getAdaptiveTarget(key);
    const excess = absCorr - target;
    const direction = -m.sign(corr);
    const heatMulti = 1.0 + m.pow(ps.heatPenalty || 0, 2) * 2.0;
    const magnitude = effectiveGain * excess * heatMulti;
    const isSevere = absCorr > at.baseline * setup.targetScale * 2.0;

    if (aIsNudgeable && bIsNudgeable) {
      const half = magnitude * 0.5;
      addNudge(dimA, -direction * half, isSevere);
      addNudge(dimB, direction * half, isSevere);
    } else {
      const nudgeAxis = aIsNudgeable ? dimA : dimB;
      addNudge(nudgeAxis, direction * magnitude, isSevere);
    }
  }

  return { computeSurfacePressures, computeAndNudge };
})();
