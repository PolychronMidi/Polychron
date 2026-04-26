

/**
 * Coupling Refresh Setup
 *
 * Pre-loop phase of the coupling manager refresh. Handles regime detection,
 * coherent share EMA, velocity spike detection, product guards (flicker
 * and density), and homeostasis state extraction. Returns a setup context
 * consumed by budget scoring, gain escalation, and bias accumulation.
 */

moduleLifecycle.declare({
  name: 'couplingRefreshSetup',
  subsystem: 'conductor',
  deps: ['validator'],
  provides: ['couplingRefreshSetup'],
  init: (deps) => {
  const V = deps.validator.create('couplingRefreshSetup');
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
        if (!V.optionalType(currCorr, 'number') || V.optionalFinite(currCorr) === undefined) continue;
        const delta = m.abs(m.abs(currCorr) - (V.optionalFinite(S.prevBeatAbsCorr[vk], 0)));
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

    // R66 E3: Phase-pair target scale increase. When phase share is low,
    // RAISE the target for phase pairs so fewer of them exceed the threshold
    // and trigger decorrelation. Higher target = less tightening = phase
    // correlations persist longer = more phase axis energy.
    const phaseFloorSnap = safePreBoot.call(() => phaseFloorController.getSnapshot(), null);
    const phaseShareEma = V.optionalFinite(phaseFloorSnap && phaseFloorSnap.shareEma, 0.1667);
    const phaseTargetScaleIncrease = phaseShareEma < 0.10 && targetScale > 0
      ? clamp((0.10 - phaseShareEma) / 0.08, 0, 1)
      : 0;
    const phaseTargetScale = phaseTargetScaleIncrease > 0
      ? targetScale * (1 + phaseTargetScaleIncrease * 0.4)
      : targetScale;

    // Flicker product guard with hysteresis (safePreBoot guarantees a finite number via its fallback)
    const flickerProd = V.optionalFinite(signalReader.snapshot()?.flickerProduct, 1.0);
    if (S.flickerGuardState === 'normal' && flickerProd < 0.90) {
      S.flickerGuardState = 'guarding';
      S.flickerGuardBeats = 0;
    } else if (S.flickerGuardState === 'guarding' && flickerProd > 0.96) {
      S.flickerGuardState = 'normal';
      S.flickerGuardBeats = 0;
    }
    if (S.flickerGuardState === 'guarding') S.flickerGuardBeats++;
    const flickerGainScalar = S.flickerGuardState === 'guarding'
      ? clamp((flickerProd - 0.80) / 0.12, 0.25, 1.0)
      : 1.0;

    // Density product guard with hysteresis
    const densityProd = V.optionalFinite(signalReader.snapshot()?.densityProduct, 1.0);
    if (S.densityGuardState === 'normal' && densityProd < 0.75) {
      S.densityGuardState = 'guarding';
      S.densityGuardBeats = 0;
    } else if (S.densityGuardState === 'guarding' && densityProd > 0.82) {
      S.densityGuardState = 'normal';
      S.densityGuardBeats = 0;
    }
    if (S.densityGuardState === 'guarding') S.densityGuardBeats++;
    const densityGainScalar = S.densityGuardState === 'guarding'
      ? clamp((densityProd - 0.65) / 0.12, 0.25, 1.0)
      : 1.0;

    // Floor dampening + homeostasis state
    const floorDampen = couplingHomeostasis.getFloorDampen();
    const hs = couplingHomeostasis.getState();
    const budgetConstraintActive = Boolean(hs && hs.budgetConstraintActive);
    const budgetConstraintPressure = V.optionalFinite(hs && hs.budgetConstraintPressure, 0);
    const floorRecoveryActive = Boolean(hs && hs.floorRecoveryActive);
    const densityFlickerTailPressure = V.optionalFinite(hs && hs.densityFlickerTailPressure, 0);
    const tailPressureByPair = V.optionalType(hs && hs.tailPressureByPair, 'object', null);
    const tailRecoveryHandshake = V.optionalFinite(hs && hs.tailRecoveryHandshake, 0);
    const densityFlickerOverridePressure = V.optionalFinite(hs && hs.densityFlickerOverridePressure, 0);
    const recoveryAxisHandOffPressure = V.optionalFinite(hs && hs.recoveryAxisHandOffPressure, 0);
    const recoveryDominantAxes = hs && Array.isArray(hs.recoveryDominantAxes) ? hs.recoveryDominantAxes : [];
    const shortRunRecoveryBias = V.optionalFinite(hs && hs.shortRunRecoveryBias, 0);
    const nonNudgeableTailPressure = V.optionalFinite(hs && hs.nonNudgeableTailPressure, 0);
    const nonNudgeableTailPair = hs && typeof hs.nonNudgeableTailPair === 'string' ? hs.nonNudgeableTailPair : '';
    const telemetryBeatSpan = Number.isFinite(snap && snap.telemetryBeatSpan) ? clamp(m.round(/** @type {number} */ (snap.telemetryBeatSpan)), 1, 8) : 1;

    // Axis energy shares for entropy pressure
    const axisShareSnapshot = pipelineCouplingManagerSnapshot.buildAxisEnergyShare(couplingState.axisSmoothedAbsR);
    const axisShares = (axisShareSnapshot && axisShareSnapshot.shares) ?? {};
    const entropyAxisShare = V.optionalFinite(axisShares.entropy, 0);
    const entropyAxisPressure = clamp((entropyAxisShare - 0.20) / 0.08, 0, 1);

    const nonNudgeableAxes = nonNudgeableTailPair && nonNudgeableTailPair.indexOf('-') !== -1
      ? nonNudgeableTailPair.split('-')
      : (recoveryDominantAxes.length > 0 ? recoveryDominantAxes.slice() : []);

    // R73 E1: Dynamic telemetry window based on homeostasis beat count
    const hsBeatCount = V.optionalFinite(hs && hs.beatCount, 0);
    const dynTelemetryWindow = couplingConstants.dynamicTelemetryWindow(hsBeatCount);

    return {
      regime, targetScale, phaseTargetScale, flickerGainScalar, densityGainScalar,
      floorDampen, flickerProd, densityProd,
      budgetConstraintActive, budgetConstraintPressure,
      floorRecoveryActive, densityFlickerTailPressure,
      tailPressureByPair, tailRecoveryHandshake,
      densityFlickerOverridePressure, recoveryAxisHandOffPressure,
      shortRunRecoveryBias, nonNudgeableTailPressure,
      nonNudgeableAxes, entropyAxisPressure,
      telemetryBeatSpan, matrix: snap.couplingMatrix,
      dynTelemetryWindow,
    };
  }

  return { run };
  },
});
