

/**
 * Regime-Reactive Damping (E4)
 *
 * Reads the current regime from systemDynamicsProfiler and adjusts
 * density / tension / flicker biases so the signal pipeline responds
 * appropriately to each dynamical phase.
 *
 * Stagnant  - inject variety (density up, flicker up)
 * Fragmented - dampen extremes (density - 1, tension - 1)
 * Oscillating - counter-cycle (flicker down)
 * Exploring - slight tension lift
 * Coherent / Evolving - neutral (1.0)
 */

regimeReactiveDamping = (() => {

  const REGIME_DENSITY_DIR = {
    stagnant: 1,
    fragmented: 0,
    oscillating: 0,
    exploring: -0.15,
    coherent: 0.15,
    evolving: 0.1,
    drifting: -1,
  };

  const REGIME_TENSION_DIR = {
    stagnant: 0.5,
    fragmented: 0,
    oscillating: 0,
    exploring: 1.25,
    coherent: 0.2,
    evolving: 1.3,
    drifting: 1,
  };

  const REGIME_FLICKER_DIR = {
    stagnant: 1,
    fragmented: -1,
    oscillating: 0,
    exploring: 1.35,
    coherent: -0.15,
    evolving: 0.7,
    drifting: 0,
  };

  const MAX_DENSITY = 0.12;
  const MAX_TENSION = 0.12;
  const MAX_FLICKER = 0.17;
  const _DENSITY_RANGE = [0.88, 1.12];
  const _TENSION_RANGE = [0.88, 1.22];
  const _FLICKER_RANGE = [0.83, 1.19];

  const CURVATURE_CEILING = 1.0;

  const BIAS_SMOOTHING = 0.20;

  const LOW_VEL_THRESHOLD = 0.015;
  const LOW_VEL_BEATS     = 8;
  const DRIFT_MAGNITUDE   = 0.22;
  const DRIFT_DECAY       = 0.93;
  let lowVelStreak = 0;
  let regimeReactiveDampingDriftD = 0;
  let regimeReactiveDampingDriftT = 0;
  let regimeReactiveDampingDriftF = 0;
  let regimeReactiveDampingInjectionCount = 0;

  const _REGIME_RING_SIZE = 64;
  /** @type {string[]} */
  const regimeReactiveDampingRegimeRing = [];
  const _REGIME_BUDGET = {
    exploring: 0.35,
    coherent: 0.35,
    evolving: 0.20,
    stagnant: 0.03,
    fragmented: 0.03,
    oscillating: 0.02,
    drifting: 0.02,
  };
  const _EQUILIB_STRENGTH = 0.28;
  let regimeReactiveDampingEqCorrD = 0;
  let regimeReactiveDampingEqCorrT = 0;
  let regimeReactiveDampingEqCorrF = 0;

  let regimeReactiveDampingTensionPinStreak = 0;
  let regimeReactiveDampingTensionUnpinStreak = 0;
  let regimeReactiveDampingTensionCeilingRelax = 0;
  const _PIN_STREAK_TRIGGER = 10;
  const _UNPIN_RESET_BEATS = 5;
  const _PIN_RELAX_STEP = 0.05;

  let currentRegime = 'evolving';
  let curvatureGain = 0;
  let regimeReactiveDampingSmoothedDensity = 1.0;
  let regimeReactiveDampingSmoothedTension = 1.0;
  let regimeReactiveDampingSmoothedFlicker = 1.0;

  let densityVarEma = 0.010;
  let densityMeanEma = 0.50;
  const _DENSITY_VAR_EMA_ALPHA = 0.008;
  const _DENSITY_VAR_TARGET_LOW = 0.009;
  const _DENSITY_VAR_TARGET_HIGH = 0.014;

  function refresh() {
    const snap = systemDynamicsProfiler.getSnapshot();
    const dynamicSnap = /** @type {any} */ (snap);
    currentRegime = snap ? snap.regime : 'evolving';
    const rawCurv = snap ? (snap.curvature || 0) : 0;
    curvatureGain = clamp(rawCurv / CURVATURE_CEILING, 0, 1);

    const equilibratorState = {
      currentRegime,
      regimeRing: regimeReactiveDampingRegimeRing,
      regimeRingSize: _REGIME_RING_SIZE,
      regimeBudget: _REGIME_BUDGET,
      equilibStrength: _EQUILIB_STRENGTH,
      eqCorrD: regimeReactiveDampingEqCorrD,
      eqCorrT: regimeReactiveDampingEqCorrT,
      eqCorrF: regimeReactiveDampingEqCorrF,
      snap,
      smoothedFlicker: regimeReactiveDampingSmoothedFlicker,
    };
    regimeReactiveDampingEquilibrator.compute(equilibratorState);
    regimeReactiveDampingEqCorrD = equilibratorState.eqCorrD;
    regimeReactiveDampingEqCorrT = equilibratorState.eqCorrT;
    regimeReactiveDampingEqCorrF = equilibratorState.eqCorrF;

    const velocity = snap ? (snap.velocity || 0) : 0;
    if (velocity < LOW_VEL_THRESHOLD) {
      lowVelStreak++;
    } else {
      lowVelStreak = 0;
      regimeReactiveDampingDriftD *= DRIFT_DECAY;
      regimeReactiveDampingDriftT *= DRIFT_DECAY;
      regimeReactiveDampingDriftF *= DRIFT_DECAY;
    }

    if (lowVelStreak >= LOW_VEL_BEATS && snap && snap.couplingMatrix) {
      const cm = snap.couplingMatrix;
      const dCoup = m.abs(cm['density-tension'] || 0) + m.abs(cm['density-flicker'] || 0);
      const tCoup = m.abs(cm['density-tension'] || 0) + m.abs(cm['tension-flicker'] || 0);
      const fCoup = m.abs(cm['density-flicker'] || 0) + m.abs(cm['tension-flicker'] || 0);

      regimeReactiveDampingInjectionCount++;
      const sign = (regimeReactiveDampingInjectionCount % 2 === 0) ? 1 : -1;

      if (dCoup <= tCoup && dCoup <= fCoup) {
        regimeReactiveDampingDriftD = sign * DRIFT_MAGNITUDE;
      } else if (tCoup <= fCoup) {
        regimeReactiveDampingDriftT = sign * DRIFT_MAGNITUDE;
      } else {
        regimeReactiveDampingDriftF = sign * DRIFT_MAGNITUDE;
      }
      lowVelStreak = 0;
    }

    const couplingMatrix = snap ? snap.couplingMatrix : null;
    const densityFlickerPressure = couplingMatrix && typeof couplingMatrix['density-flicker'] === 'number' && Number.isFinite(couplingMatrix['density-flicker'])
      ? clamp((m.abs(couplingMatrix['density-flicker']) - 0.76) / 0.18, 0, 1)
      : 0;
    const tensionFlickerPressure = couplingMatrix && typeof couplingMatrix['tension-flicker'] === 'number' && Number.isFinite(couplingMatrix['tension-flicker'])
      ? clamp((m.abs(couplingMatrix['tension-flicker']) - 0.76) / 0.16, 0, 1)
      : 0;
    const densityTrustPressure = couplingMatrix && typeof couplingMatrix['density-trust'] === 'number' && Number.isFinite(couplingMatrix['density-trust'])
      ? clamp((m.abs(couplingMatrix['density-trust']) - 0.72) / 0.18, 0, 1)
      : 0;
    const flickerTrustPressure = couplingMatrix && typeof couplingMatrix['flicker-trust'] === 'number' && Number.isFinite(couplingMatrix['flicker-trust'])
      ? clamp((m.abs(couplingMatrix['flicker-trust']) - 0.68) / 0.18, 0, 1)
      : 0;
    const axisEnergy = safePreBoot.call(() => pipelineCouplingManager.getAxisEnergyShare(), null);
    const phaseShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.phase === 'number'
      ? axisEnergy.shares.phase
      : 1.0 / 6.0;
    const trustShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.trust === 'number'
      ? axisEnergy.shares.trust
      : 1.0 / 6.0;
    const signalHealth = safePreBoot.call(() => signalHealthAnalyzer.getHealth(), null);
    const densityHealth = signalHealth && signalHealth.density ? signalHealth.density : null;
    const lowPhaseThreshold = safePreBoot.call(() => phaseFloorController.getLowShareThreshold(), 0.03) || 0.03;
    const phaseContainmentTarget = 0.09;
    const lowPhasePressure = clamp((lowPhaseThreshold - phaseShare) / m.max(lowPhaseThreshold, 0.01), 0, 1);
    const phaseRecoveryCredit = clamp((phaseShare - phaseContainmentTarget) / 0.05, 0, 1);
    const flickerPhasePressure = couplingMatrix && typeof couplingMatrix['flicker-phase'] === 'number' && Number.isFinite(couplingMatrix['flicker-phase'])
      ? clamp((m.abs(couplingMatrix['flicker-phase']) - 0.62) / 0.18, 0, 1)
      : 0;
    const trustSharePressure = clamp((trustShare - 0.17) / 0.08, 0, 1);
    const densitySaturationPressure = densityHealth
      ? clamp((densityHealth.saturated ? 0.45 : 0) + clamp((densityHealth.crushFactor - 0.35) / 0.40, 0, 1) * 0.55, 0, 1)
      : 0;
    const evolvingShare = dynamicSnap && typeof dynamicSnap.evolvingShare === 'number'
      ? dynamicSnap.evolvingShare
      : 0;
    const evolvingRecoveryPressure = clamp((0.10 - evolvingShare) / 0.10, 0, 1);
    const topPairConcentration = dynamicSnap && typeof dynamicSnap.hotspotTop2Concentration === 'number'
      ? dynamicSnap.hotspotTop2Concentration
      : 0;
    const containedTailRecovery = clamp((0.78 - topPairConcentration) / 0.18, 0, 1) * (1 - densityFlickerPressure * 0.55) * (1 - tensionFlickerPressure * 0.45);
    const longFormBuildPressure = totalSections >= 5 && sectionIndex > 0 && sectionIndex < totalSections - 1 ? 1 : 0;
    const densityAxisShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.density === 'number'
      ? axisEnergy.shares.density
      : 1.0 / 6.0;
    const densityAxisDeficit = clamp((1.0 / 6.0 - densityAxisShare) / 0.05, 0, 1);
    const regimeFlickerHotspotBrake = clamp(
      (densityFlickerPressure * 0.08 + tensionFlickerPressure * 0.12 + flickerTrustPressure * 0.10 + lowPhasePressure * 0.02 + trustSharePressure * 0.03 + densitySaturationPressure * 0.04 + flickerPhasePressure * (0.05 + phaseRecoveryCredit * 0.08) + clamp((topPairConcentration - 0.72) / 0.20, 0, 1) * 0.04) * ((currentRegime === 'exploring' || currentRegime === 'coherent') ? 1 : 0.6),
      0,
      0.20
    );
    const flickerShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.flicker === 'number'
      ? axisEnergy.shares.flicker
      : 1.0 / 6.0;
    const flickerDeficit = clamp((1.0 / 6.0 - flickerShare) / 0.05, 0, 1);
    const flickerRecoveryRelief = 1.0 - flickerDeficit * 0.25;
    const adjustedFlickerHotspotBrake = regimeFlickerHotspotBrake * flickerRecoveryRelief;
    const densityHotspotBrake = clamp((densityFlickerPressure * (0.010 + phaseRecoveryCredit * 0.015) + densityTrustPressure * 0.020 + trustSharePressure * 0.022 + densitySaturationPressure * (0.032 + lowPhasePressure * 0.025) + clamp((topPairConcentration - 0.70) / 0.15, 0, 1) * densityFlickerPressure * 0.020) * (0.45 + phaseRecoveryCredit * 0.55), 0, 0.09);
    const tensionSignal = safePreBoot.call(() => conductorState.getField('tension'), null);
    const tensionValue = typeof tensionSignal === 'number' && Number.isFinite(tensionSignal)
      ? tensionSignal
      : 0.5;
    const tensionRecoveryNudge = longFormBuildPressure * phaseRecoveryCredit * clamp((0.58 - tensionValue) / 0.22, 0, 1) * (1 - tensionFlickerPressure * 0.45) * 0.02;
    const exploringBiasBrake = currentRegime === 'exploring'
      ? clamp(trustSharePressure * 0.04 + densityTrustPressure * 0.015 + densitySaturationPressure * 0.04 + lowPhasePressure * 0.03 + evolvingRecoveryPressure * 0.05, 0, 0.12)
      : 0;
    const evolvingLift = currentRegime === 'evolving'
      ? clamp((1 - densityFlickerPressure) * 0.02 + lowPhasePressure * 0.04 + trustSharePressure * 0.02 + evolvingRecoveryPressure * 0.05 + phaseRecoveryCredit * 0.03 + containedTailRecovery * (0.025 + longFormBuildPressure * 0.01), 0, 0.12)
      : 0;
    const coherentToEvolvingReheat = currentRegime === 'coherent'
      ? clamp(evolvingRecoveryPressure * 0.045 + phaseRecoveryCredit * 0.018 + containedTailRecovery * 0.018 - densityFlickerPressure * 0.008 - tensionFlickerPressure * 0.018, 0, 0.08)
      : 0;
    const tensionFlickerRelease = clamp(tensionFlickerPressure * (0.045 + evolvingRecoveryPressure * 0.02 + phaseRecoveryCredit * 0.015 + densityAxisDeficit * 0.02) * ((currentRegime === 'coherent' || currentRegime === 'evolving') ? 1 : 0.7) + clamp((topPairConcentration - 0.68) / 0.13, 0, 1) * tensionFlickerPressure * 0.07 + densityAxisDeficit * tensionFlickerPressure * 0.05, 0, 0.18);
    const densityRebalanceLift = clamp(tensionFlickerPressure * (0.015 + phaseRecoveryCredit * 0.01 + densityAxisDeficit * 0.012) * (1 - densityFlickerPressure * 0.6), 0, 0.04);
    const ftRaw = couplingMatrix ? couplingMatrix['flicker-trust'] : 0;
    const flickerTrustCoupling = Number.isFinite(ftRaw) ? m.abs(ftRaw) : 0;
    const ftDecoupleBrake = clamp((flickerTrustCoupling - 0.40) / 0.30, 0, 1) * 0.06;

    const sectionProgress = clamp(sectionIndex / m.max(1, totalSections - 1), 0, 1);
    const sectionTensionNudge = m.sin(sectionProgress * m.PI) * 0.045;
    const densityArchProgress = m.abs(sectionProgress - 0.5) * 2;
    const currentDensitySignal = safePreBoot.call(() => signalReader.density(), null);
    if (typeof currentDensitySignal === 'number' && Number.isFinite(currentDensitySignal)) {
      densityMeanEma += (currentDensitySignal - densityMeanEma) * _DENSITY_VAR_EMA_ALPHA;
      const densityDevSq = (currentDensitySignal - densityMeanEma) * (currentDensitySignal - densityMeanEma);
      densityVarEma += (densityDevSq - densityVarEma) * _DENSITY_VAR_EMA_ALPHA;
    }
    const densityArchScale = densityVarEma < _DENSITY_VAR_TARGET_LOW
      ? 1.0 + clamp((_DENSITY_VAR_TARGET_LOW - densityVarEma) / 0.005, 0, 1)
      : densityVarEma > _DENSITY_VAR_TARGET_HIGH
        ? 1.0 - clamp((densityVarEma - _DENSITY_VAR_TARGET_HIGH) / 0.006, 0, 1) * 0.4
        : 1.0;
    const sectionDensityNudge = (densityArchProgress - 0.5) * 0.04 * densityArchScale;
    const midSectionDensityPush = m.sin(sectionProgress * m.PI) * 0.013;
    const densityShare = densityAxisShare;
    const densityShareBrake = clamp((densityShare - 0.17) / 0.06, 0, 1) * 0.04;
    const densityDeficit = clamp((1.0 / 6.0 - densityShare) / 0.05, 0, 1);
    const densityRecoveryLift = densityDeficit * 0.015;
    const coherentDFRaw = couplingMatrix ? couplingMatrix['density-flicker'] : 0;
    const coherentDFAbs = Number.isFinite(coherentDFRaw) ? m.abs(coherentDFRaw) : 0;
    const coherentDFBrake = currentRegime === 'coherent' && coherentDFAbs > 0.40
      ? clamp((coherentDFAbs - 0.40) / 0.30, 0, 1) * 0.025
      : 0;
    const dtRaw = couplingMatrix ? couplingMatrix['density-tension'] : 0;
    const dtAbs = Number.isFinite(dtRaw) ? m.abs(dtRaw) : 0;
    const dtDensityBrake = dtAbs > 0.55
      ? clamp((dtAbs - 0.55) / 0.30, 0, 1) * 0.006
      : 0;
    const journeyBoldness = safePreBoot.call(
      () => journeyRhythmCoupler.getBoldness(), 0
    );
    const dtCoMovementPush = journeyBoldness > 0.25
      ? clamp((journeyBoldness - 0.25) / 0.60, 0, 1) * 0.030
      : 0;
    const tensionShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.tension === 'number'
      ? axisEnergy.shares.tension
      : 1.0 / 6.0;
    const dtShareGap = clamp(tensionShare - densityShare, 0, 0.12) / 0.12;
    const dtShareBridgeLift = dtAbs > 0.45
      ? clamp((dtAbs - 0.45) / 0.35, 0, 1) * dtShareGap * 0.015
      : 0;
    const rawD = 1.0 + (REGIME_DENSITY_DIR[currentRegime] || 0) * MAX_DENSITY * curvatureGain + regimeReactiveDampingDriftD + regimeReactiveDampingEqCorrD - densityHotspotBrake + evolvingLift * 0.5 + densityRebalanceLift + sectionDensityNudge + midSectionDensityPush - densityShareBrake + densityRecoveryLift - coherentDFBrake - dtDensityBrake + dtCoMovementPush + dtShareBridgeLift;
    const effectiveMaxTension = MAX_TENSION + regimeReactiveDampingTensionCeilingRelax;
    const tensionShareBrake = clamp((tensionShare - 0.18) / 0.08, 0, 1) * 0.06;
    const tensionRecoveryLift2 = tensionShare < 0.17
      ? clamp((0.17 - tensionShare) / 0.06, 0, 1) * 0.018
      : 0;
    const boldnessTensionPush = journeyBoldness > 0.25
      ? clamp((journeyBoldness - 0.25) / 0.60, 0, 1) * 0.030
      : 0;
    const dtTensionTrim = dtAbs > 0.45
      ? clamp((dtAbs - 0.45) / 0.35, 0, 1) * dtShareGap * 0.010
      : 0;
    const rawT = 1.0 + (REGIME_TENSION_DIR[currentRegime] || 0) * effectiveMaxTension * curvatureGain + regimeReactiveDampingDriftT + regimeReactiveDampingEqCorrT + sectionTensionNudge + tensionRecoveryNudge + evolvingLift + coherentToEvolvingReheat - exploringBiasBrake - tensionFlickerRelease - tensionShareBrake + boldnessTensionPush + tensionRecoveryLift2 - dtTensionTrim;
    const dfRaw = couplingMatrix ? couplingMatrix['density-flicker'] : 0;
    const dfCoupling = Number.isFinite(dfRaw) ? m.abs(dfRaw) : 0;
    const archOffset = clamp((dfCoupling - 0.35) / 0.40, 0, 1) * 0.15;
    const flickerArchCenter = 0.5 + archOffset;
    const flickerArchProgress = 1 - m.abs(sectionProgress - flickerArchCenter) * 2;
    const sectionFlickerNudge = (clamp(flickerArchProgress, 0, 1) - 0.5) * 0.04;
    const flickerShareBrake = clamp((flickerShare - 0.18) / 0.10, 0, 1) * 0.08;
    const rawF = 1.0 + (REGIME_FLICKER_DIR[currentRegime] || 0) * MAX_FLICKER * curvatureGain + regimeReactiveDampingDriftF + regimeReactiveDampingEqCorrF - adjustedFlickerHotspotBrake + evolvingLift - exploringBiasBrake - coherentToEvolvingReheat * 0.5 - tensionFlickerRelease * 0.7 + sectionFlickerNudge - ftDecoupleBrake - flickerShareBrake;
    regimeReactiveDampingSmoothedDensity = clamp(regimeReactiveDampingSmoothedDensity * (1 - BIAS_SMOOTHING) + rawD * BIAS_SMOOTHING, _DENSITY_RANGE[0], _DENSITY_RANGE[1]);
    regimeReactiveDampingSmoothedTension = clamp(regimeReactiveDampingSmoothedTension * (1 - BIAS_SMOOTHING) + rawT * BIAS_SMOOTHING, _TENSION_RANGE[0], _TENSION_RANGE[1]);
    regimeReactiveDampingSmoothedFlicker = clamp(regimeReactiveDampingSmoothedFlicker * (1 - BIAS_SMOOTHING) + rawF * BIAS_SMOOTHING, _FLICKER_RANGE[0], _FLICKER_RANGE[1]);

    const tensionAtPin = m.abs(regimeReactiveDampingSmoothedTension - (1.0 + effectiveMaxTension)) < 0.005
                      || m.abs(regimeReactiveDampingSmoothedTension - (1.0 - effectiveMaxTension)) < 0.005;
    if (tensionAtPin) {
      regimeReactiveDampingTensionPinStreak++;
      regimeReactiveDampingTensionUnpinStreak = 0;
      if (regimeReactiveDampingTensionPinStreak > _PIN_STREAK_TRIGGER) {
        regimeReactiveDampingTensionCeilingRelax = clamp(regimeReactiveDampingTensionCeilingRelax + MAX_TENSION * _PIN_RELAX_STEP, 0, MAX_TENSION * 0.30);
        regimeReactiveDampingTensionPinStreak = 0;
        safePreBoot.call(() => explainabilityBus.emit('tension-pin-relief', 'both', {
          newCeiling: MAX_TENSION + regimeReactiveDampingTensionCeilingRelax,
          baseCeiling: MAX_TENSION
        }));
      }
    } else {
      regimeReactiveDampingTensionUnpinStreak++;
      regimeReactiveDampingTensionPinStreak = 0;
      if (regimeReactiveDampingTensionUnpinStreak > _UNPIN_RESET_BEATS) {
        regimeReactiveDampingTensionCeilingRelax = 0;
        regimeReactiveDampingTensionUnpinStreak = 0;
      }
    }

    regimeReactiveDampingDriftD *= DRIFT_DECAY;
    regimeReactiveDampingDriftT *= DRIFT_DECAY;
    regimeReactiveDampingDriftF *= DRIFT_DECAY;
  }

  function densityBias() {
    return regimeReactiveDampingSmoothedDensity;
  }

  function tensionBias() {
    return regimeReactiveDampingSmoothedTension;
  }

  function flickerMod() {
    return regimeReactiveDampingSmoothedFlicker;
  }

  function reset() {
    currentRegime = 'evolving';
    curvatureGain = 0;
    regimeReactiveDampingSmoothedDensity = 1.0;
    regimeReactiveDampingSmoothedTension = 1.0;
    regimeReactiveDampingSmoothedFlicker = 1.0;
    lowVelStreak = 0;
    regimeReactiveDampingRegimeRing.length = 0;
    regimeReactiveDampingEqCorrD = 0;
    regimeReactiveDampingEqCorrT = 0;
    regimeReactiveDampingEqCorrF = 0;
    regimeReactiveDampingTensionPinStreak = 0;
    regimeReactiveDampingTensionUnpinStreak = 0;
    regimeReactiveDampingTensionCeilingRelax = 0;
  }

  conductorIntelligence.registerDensityBias('regimeReactiveDamping', densityBias, _DENSITY_RANGE[0], _DENSITY_RANGE[1]);
  conductorIntelligence.registerTensionBias('regimeReactiveDamping', tensionBias, _TENSION_RANGE[0], _TENSION_RANGE[1]);
  conductorIntelligence.registerFlickerModifier('regimeReactiveDamping', flickerMod, _FLICKER_RANGE[0], _FLICKER_RANGE[1]);
  conductorIntelligence.registerRecorder('regimeReactiveDamping', refresh);
  conductorIntelligence.registerModule('regimeReactiveDamping', { reset }, ['section']);

  feedbackRegistry.registerLoop(
    'regimeReactiveDamping',
    'regime',
    'density',
    () => m.abs(regimeReactiveDampingSmoothedDensity - 1.0) / MAX_DENSITY,
    () => m.sign(regimeReactiveDampingSmoothedDensity - 1.0)
  );

  return { densityBias, tensionBias, flickerMod, reset };
})();
