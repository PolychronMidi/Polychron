

/**
 * Homeostasis Tick
 *
 * Per-beat multiplier management. Called from processBeat's post-beat
 * stage on every beat-layer entry (~418/run). Provides smoother
 * multiplier evolution than the measure-only recorder invocation (~78/run).
 * Includes proportional control, tail recovery, floor recovery,
 * exceedance braking, and time-series capture.
 */

homeostasisTick = (() => {
  const V = validator.create('homeostasisTick');
  const { GAIN_FLOOR, GINI_THRESHOLD,
    MAX_TIME_SERIES, FLOOR_RECOVERY_TRIGGER, FLOOR_RECOVERY_HOLD } = homeostasisConstants;

  function tick() {
    const S = homeostasisState;
    S.tickCount++;

    const tailRecoveryPressure = m.max(S.stickyTailPressure, S.densityFlickerTailPressure, S.tailRecoveryDrive);
    let nonNudgeableTailPressure = S.nonNudgeableTailPressure;
    // R78 E5: Age non-nudgeable tail pressure. Persistent non-zero pressure
    // (entropy-trust p95 0.896) drags budget without correction. Decay after
    // 1 tick, floored at 85% of raw value (75 ticks to reach floor).
    if (nonNudgeableTailPressure > 0) {
      S.nonNudgeableTailIdleTicks = (S.nonNudgeableTailIdleTicks || 0) + 1;
      nonNudgeableTailPressure *= m.max(0.85, 1.0 - S.nonNudgeableTailIdleTicks * 0.002);
    } else {
      S.nonNudgeableTailIdleTicks = 0;
    }
    const dynamicsSnapshot = safePreBoot.call(() => systemDynamicsProfiler.getSnapshot(), null);
    const densityFlickerAbs = dynamicsSnapshot && dynamicsSnapshot.couplingMatrix && typeof dynamicsSnapshot.couplingMatrix['density-flicker'] === 'number'
      ? m.abs(dynamicsSnapshot.couplingMatrix['density-flicker'])
      : 0;
    S.densityFlickerClampPressure = clamp(
      S.densityFlickerTailPressure * 0.65 +
      clamp((densityFlickerAbs - 0.88) / 0.10, 0, 1) * 0.35,
      0,
      1
    );
    S.tailRecoveryCeilingPressure = clamp((S.globalGainMultiplier - 0.94) / 0.06, 0, 1);
    S.tailRecoveryHandshake = clamp(
      tailRecoveryPressure * 0.70 +
      m.max(0, S.tailHotspotCount - 1) * 0.05 +
      (S.floorRecoveryTicksRemaining > 0 ? 0.12 : 0) +
      S.tailRecoveryCeilingPressure * 0.22 +
      S.densityFlickerClampPressure * 0.18 +
      nonNudgeableTailPressure * 0.16,
      0,
      1
    );
    // R75 E2 + R76 E2: Exponential decay to prevent chronic saturation.
    // Original 0.995/tick was too weak (produced only 0.005 drop from 1.0).
    // Doubled to 0.990/tick = ~36% after 100 ticks of zero pressure,
    // shifting the equilibrium to 0.90-0.95 range under persistent tail
    // pressure (stickyTailPressure 0.748).
    S.tailRecoveryHandshake *= 0.990;
    S.densityFlickerOverridePressure = clamp(
      (S.dominantTailPair === 'density-flicker' ? 0.34 : 0) +
      S.densityFlickerTailPressure * 0.34 +
      S.densityFlickerClampPressure * 0.22 +
      (S.floorRecoveryTicksRemaining > 0 ? 0.10 : 0),
      0,
      1
    );
    S.recoveryAxisHandOffPressure = clamp(
      (S.floorRecoveryTicksRemaining > 0 ? 0.24 : 0) +
      S.densityFlickerClampPressure * 0.28 +
      S.tailRecoveryHandshake * 0.24 +
      clamp((S.tailHotspotCount - 1) / 5, 0, 1) * 0.12 +
      nonNudgeableTailPressure * 0.26,
      0,
      1
    );
    S.shortRunRecoveryBias = Number((Number.isFinite(totalSections) && totalSections > 0 && totalSections <= 5 && S.tickCount <= 96
      ? clamp(
        S.tailRecoveryHandshake * 0.40 +
        S.densityFlickerClampPressure * 0.32 +
        (S.floorRecoveryTicksRemaining > 0 ? 0.18 : 0) +
        clamp((S.tailHotspotCount - 1) / 5, 0, 1) * 0.10 +
        nonNudgeableTailPressure * 0.14,
        0,
        0.65
      )
      : 0).toFixed(4));
    S.recoveryAxisHandOffPressure = clamp(S.recoveryAxisHandOffPressure + S.shortRunRecoveryBias * 0.45, 0, 1);
    S.recoveryDominantAxes = S.nonNudgeableTailPressure > 0.24 && S.nonNudgeableTailPair && S.nonNudgeableTailPair.indexOf('-') !== -1
      ? S.nonNudgeableTailPair.split('-')
      : (S.dominantTailPair && S.dominantTailPair.indexOf('-') !== -1
        ? S.dominantTailPair.split('-')
        : []);
    S.tailRecoveryCap = clamp(0.96 - S.tailRecoveryHandshake * 0.22 - m.max(0, S.tailHotspotCount - 2) * 0.01 - S.densityFlickerClampPressure * 0.09 - nonNudgeableTailPressure * 0.05, GAIN_FLOOR, 0.94);
    if (S.stickyTailPressure > 0.50) {
      S.tailRecoveryCap = m.max(S.tailRecoveryCap, clamp(0.65 - (S.stickyTailPressure - 0.50) * 0.20, 0.55, 0.65));
    }

    if (S.refreshedThisTick) {
      S.refreshedThisTick = false;
    } else {
      let targetMultiplier = S.energyBudget > 0.1
        ? clamp(S.energyBudget / m.max(S.totalEnergyEma, 0.1), GAIN_FLOOR, 1.0)
        : 1.0;
      if (S.redistributionScore > 0.15) {
        targetMultiplier = m.max(GAIN_FLOOR, targetMultiplier - S.redistributionScore * 0.15);
      }
      if (S.giniCoefficient > GINI_THRESHOLD) {
        const giniPenalty = clamp((S.giniCoefficient - GINI_THRESHOLD) * 0.3, 0, 0.08);
        targetMultiplier = m.max(GAIN_FLOOR, targetMultiplier - giniPenalty);
      }
      if (tailRecoveryPressure > S.tailRecoveryTrigger * 0.85) {
        targetMultiplier = m.min(targetMultiplier, S.tailRecoveryCap);
      }
      if (S.densityFlickerClampPressure > 0.20) {
        targetMultiplier = m.min(targetMultiplier, 0.90 - S.densityFlickerClampPressure * 0.18);
      }
      const homeostasisTickEmaAlpha = S.floorRecoveryTicksRemaining > 0 ? 0.10 : 0.05;
      S.globalGainMultiplier = S.globalGainMultiplier * (1 - homeostasisTickEmaAlpha) + targetMultiplier * homeostasisTickEmaAlpha;
    }
    const floorContactNow = S.globalGainMultiplier <= 0.22 || homeostasisFloor.getFloorDampen() < 0.60;
    const persistentTailNow = tailRecoveryPressure > S.tailRecoveryTrigger && (
      S.redistributionScore > 0.25 ||
      S.nudgeableRedistributionScore > 0.20 ||
      S.giniCoefficient > (GINI_THRESHOLD - 0.05) ||
      S.overBudget
    );
    if (floorContactNow || persistentTailNow) {
      S.floorRecoveryContactTicks += persistentTailNow && !floorContactNow ? 2 : 1;
      if (S.floorRecoveryContactTicks > FLOOR_RECOVERY_TRIGGER) {
        S.floorRecoveryTicksRemaining = FLOOR_RECOVERY_HOLD + m.floor(tailRecoveryPressure * 8);
      }
    } else {
      S.floorRecoveryContactTicks = 0;
    }
    if (S.floorRecoveryTicksRemaining > 0) {
      const recoveryFloor = clamp(0.35 + tailRecoveryPressure * 0.16 + m.max(0, S.tailHotspotCount - 1) * 0.01, GAIN_FLOOR, 0.58);
      S.globalGainMultiplier = S.globalGainMultiplier * 0.82 + m.max(S.globalGainMultiplier, recoveryFloor) * 0.18;
      S.floorRecoveryTicksRemaining--;
    }
    if (S.tailRecoveryHandshake > 0.18 && tailRecoveryPressure > S.tailRecoveryTrigger * 0.85 && S.globalGainMultiplier > S.tailRecoveryCap) {
      S.globalGainMultiplier = S.globalGainMultiplier * 0.80 + S.tailRecoveryCap * 0.20;
    }

    S.multiplierMin = m.min(S.multiplierMin, S.globalGainMultiplier);
    S.multiplierMax = m.max(S.multiplierMax, S.globalGainMultiplier);

    // Exceedance Multiplier Brake
    let applyBrake = false;
    if (dynamicsSnapshot && dynamicsSnapshot.couplingMatrix) {
      for (const pair in dynamicsSnapshot.couplingMatrix) {
        const val = dynamicsSnapshot.couplingMatrix[pair];
        const rolling = V.optionalFinite(val);
        if (rolling !== undefined && m.abs(rolling) > 0.85) {
          S.exceedanceTicks[pair] = (S.exceedanceTicks[pair] || 0) + 1;
          const limitTicks = m.max(5, m.floor(S.tickCount * 0.015));
          if (S.exceedanceTicks[pair] >= limitTicks) applyBrake = true;
        } else {
          S.exceedanceTicks[pair] = 0;
        }
      }
    }
    if (applyBrake) {
      const brakeScale = S.densityFlickerClampPressure > 0.35 ? 0.76
        : S.floorRecoveryTicksRemaining > 0 && tailRecoveryPressure > S.tailRecoveryTrigger
          ? 0.86
          : (S.tailRecoveryHandshake > 0.25 ? 0.80 : 0.85);
      S.globalGainMultiplier = m.max(GAIN_FLOOR, S.globalGainMultiplier * brakeScale);
    }

    pipelineCouplingManager.setGlobalGainMultiplier(S.globalGainMultiplier);

    if (S.multiplierTimeSeries.length < MAX_TIME_SERIES) {
      S.multiplierTimeSeries.push({
        beat: S.tickCount,
        m: Number(S.globalGainMultiplier.toFixed(3)),
        e: Number(S.totalEnergyEma.toFixed(2)),
        r: Number(S.redistributionScore.toFixed(2))
      });
    }
  }

  return { tick };
})();
