// @ts-check

/**
 * Coupling Refresh Setup
 *
 * Pre-loop phase of the coupling manager refresh. Handles regime detection,
 * coherent share EMA, velocity spike detection, product guards (flicker
 * and density), and homeostasis state extraction. Returns a setup context
 * consumed by budget scoring, gain escalation, and bias accumulation.
 */

couplingRefreshSetup = (() => {
  const { COHERENT_SHARE_EMA_ALPHA, VELOCITY_EMA_ALPHA, VELOCITY_TRIGGER_RATIO,
    VELOCITY_BOOST_BEATS } = couplingConstants;

  /**
   * Run pre-loop setup. Mutates couplingState for guards/velocity and
   * returns a context object used by the per-pair loop and post-loop.
   * @param {{ regime: string, couplingMatrix: Record<string, number>, telemetryBeatSpan?: number }} snap
   * @returns {object}
   */
  function run(snap) {
    const S = couplingState;

    // Adaptive coherent relaxation (#6 hypermeta)
    const regime = snap.regime;
    const isCoherent = regime === 'coherent' ? 1 : 0;
    S.coherentShareEma = S.coherentShareEma * (1 - COHERENT_SHARE_EMA_ALPHA) + isCoherent * COHERENT_SHARE_EMA_ALPHA;
    const dynamicCoherentRelax = 1.0 + m.max(0, 0.50 - S.coherentShareEma) * 1.2;

    if (regime === 'exploring') { S.exploringBeatCount++; } else { S.exploringBeatCount = 0; }

    // Coupling velocity computation for preemptive spike dampening
    let maxPairDelta = 0;
    const prevKeys = Object.keys(S.prevBeatAbsCorr);
    if (prevKeys.length > 0) {
      for (let vi = 0; vi < prevKeys.length; vi++) {
        const vk = prevKeys[vi];
        const currCorr = snap.couplingMatrix[vk];
        if (typeof currCorr !== 'number' || !Number.isFinite(currCorr)) continue;
        const delta = m.abs(m.abs(currCorr) - (S.prevBeatAbsCorr[vk] || 0));
        if (delta > maxPairDelta) maxPairDelta = delta;
      }
    }
    if (S.couplingVelocityEma < 0.001) {
      S.couplingVelocityEma = maxPairDelta;
    } else {
      S.couplingVelocityEma = S.couplingVelocityEma * (1 - VELOCITY_EMA_ALPHA) + maxPairDelta * VELOCITY_EMA_ALPHA;
    }
    S.velocityBoostActive = (S.couplingVelocityEma > 0.01 && maxPairDelta > S.couplingVelocityEma * VELOCITY_TRIGGER_RATIO);
    if (S.velocityBoostActive) {
      S.velocityBoostCooldown = VELOCITY_BOOST_BEATS;
    } else if (S.velocityBoostCooldown > 0) {
      S.velocityBoostCooldown--;
    }

    // Target scale: coherent relaxation or partial exploring relaxation
    let targetScale = 1.0;
    if (regime === 'coherent') {
      targetScale = dynamicCoherentRelax;
    } else if (regime === 'exploring' && S.exploringBeatCount > 40) {
      targetScale = 1.0 + (dynamicCoherentRelax - 1.0) * 0.40;
    }

    // Flicker product guard with hysteresis
    const flickerProd = safePreBoot.call(() => signalReader.snapshot()?.flickerProduct, 1.0);
    if (typeof flickerProd === 'number') {
      if (S.flickerGuardState === 'normal' && flickerProd < 0.90) {
        S.flickerGuardState = 'guarding';
        S.flickerGuardBeats = 0;
      } else if (S.flickerGuardState === 'guarding' && flickerProd > 0.96) {
        S.flickerGuardState = 'normal';
        S.flickerGuardBeats = 0;
      }
      if (S.flickerGuardState === 'guarding') S.flickerGuardBeats++;
    }
    const flickerGainScalar = S.flickerGuardState === 'guarding' && typeof flickerProd === 'number'
      ? clamp((flickerProd - 0.80) / 0.12, 0.25, 1.0)
      : 1.0;

    // Density product guard with hysteresis
    const densityProd = safePreBoot.call(() => signalReader.snapshot()?.densityProduct, 1.0);
    if (typeof densityProd === 'number') {
      if (S.densityGuardState === 'normal' && densityProd < 0.75) {
        S.densityGuardState = 'guarding';
        S.densityGuardBeats = 0;
      } else if (S.densityGuardState === 'guarding' && densityProd > 0.82) {
        S.densityGuardState = 'normal';
        S.densityGuardBeats = 0;
      }
      if (S.densityGuardState === 'guarding') S.densityGuardBeats++;
    }
    const densityGainScalar = S.densityGuardState === 'guarding' && typeof densityProd === 'number'
      ? clamp((densityProd - 0.65) / 0.12, 0.25, 1.0)
      : 1.0;

    // Floor dampening + homeostasis state
    const floorDampen = safePreBoot.call(() => couplingHomeostasis.getFloorDampen(), 1.0) || 1.0;
    const hs = safePreBoot.call(() => couplingHomeostasis.getState(), null);
    const budgetConstraintActive = Boolean(hs && hs.budgetConstraintActive);
    const budgetConstraintPressure = hs && typeof hs.budgetConstraintPressure === 'number' ? hs.budgetConstraintPressure : 0;
    const floorRecoveryActive = Boolean(hs && hs.floorRecoveryActive);
    const densityFlickerTailPressure = hs && typeof hs.densityFlickerTailPressure === 'number' ? hs.densityFlickerTailPressure : 0;
    const tailPressureByPair = hs && hs.tailPressureByPair && typeof hs.tailPressureByPair === 'object' ? hs.tailPressureByPair : null;
    const tailRecoveryHandshake = hs && typeof hs.tailRecoveryHandshake === 'number' ? hs.tailRecoveryHandshake : 0;
    const densityFlickerOverridePressure = hs && typeof hs.densityFlickerOverridePressure === 'number' ? hs.densityFlickerOverridePressure : 0;
    const recoveryAxisHandOffPressure = hs && typeof hs.recoveryAxisHandOffPressure === 'number' ? hs.recoveryAxisHandOffPressure : 0;
    const recoveryDominantAxes = hs && Array.isArray(hs.recoveryDominantAxes) ? hs.recoveryDominantAxes : [];
    const shortRunRecoveryBias = hs && typeof hs.shortRunRecoveryBias === 'number' ? hs.shortRunRecoveryBias : 0;
    const nonNudgeableTailPressure = hs && typeof hs.nonNudgeableTailPressure === 'number' ? hs.nonNudgeableTailPressure : 0;
    const nonNudgeableTailPair = hs && typeof hs.nonNudgeableTailPair === 'string' ? hs.nonNudgeableTailPair : '';
    const telemetryBeatSpan = snap && typeof snap.telemetryBeatSpan === 'number' ? clamp(m.round(snap.telemetryBeatSpan), 1, 8) : 1;

    // Axis energy shares for entropy pressure
    const axisShareSnapshot = pipelineCouplingManagerSnapshot.buildAxisEnergyShare(couplingState.axisSmoothedAbsR);
    const axisShares = axisShareSnapshot && axisShareSnapshot.shares ? axisShareSnapshot.shares : {};
    const entropyAxisShare = typeof axisShares.entropy === 'number' && Number.isFinite(axisShares.entropy) ? axisShares.entropy : 0;
    const entropyAxisPressure = clamp((entropyAxisShare - 0.20) / 0.08, 0, 1);

    const nonNudgeableAxes = nonNudgeableTailPair && nonNudgeableTailPair.indexOf('-') !== -1
      ? nonNudgeableTailPair.split('-')
      : (recoveryDominantAxes.length > 0 ? recoveryDominantAxes.slice() : []);

    return {
      regime, targetScale, flickerGainScalar, densityGainScalar,
      floorDampen, flickerProd, densityProd,
      budgetConstraintActive, budgetConstraintPressure,
      floorRecoveryActive, densityFlickerTailPressure,
      tailPressureByPair, tailRecoveryHandshake,
      densityFlickerOverridePressure, recoveryAxisHandOffPressure,
      shortRunRecoveryBias, nonNudgeableTailPressure,
      nonNudgeableAxes, entropyAxisPressure,
      telemetryBeatSpan, matrix: snap.couplingMatrix,
    };
  }

  return { run };
})();
