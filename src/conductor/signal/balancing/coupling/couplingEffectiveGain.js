// @ts-check

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
        (flags.isPhaseSurfacePair ? clamp((p95 - 0.82) / 0.14, 0, 1) * 0.55 + tailTelemetry.hotspotRate * 0.20 : 0) +
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
      effectiveGain *= m.max(0.15, 1.0 - antiCorrDepth * 0.80);
    }
    // Positive correlation preemptive brake (R72 E3: graduated)
    if (corr > 0.50) {
      const posCorrDepth = clamp((corr - 0.50) / 0.40, 0, 1);
      const posCorrFloor = (sp.tailPressure > 0.50) ? 0.50 : 0.30;
      effectiveGain *= m.max(posCorrFloor, 1.0 - posCorrDepth * 0.55);
    }
    // R71 E1: Density-flicker decorrelation ceiling
    if (flags.isDensityFlickerPair && p95 > 0.88 && telemetrySevereRate > 0.08) {
      effectiveGain = m.min(effectiveGain, 0.20);
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
