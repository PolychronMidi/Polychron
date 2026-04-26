

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

moduleLifecycle.declare({
  name: 'regimeReactiveDamping',
  subsystem: 'conductor',
  deps: ['conductorIntelligence', 'signalReader', 'systemDynamicsProfiler', 'validator'],
  provides: ['regimeReactiveDamping'],
  init: (deps) => {
  const systemDynamicsProfiler = deps.systemDynamicsProfiler;
  const signalReader = deps.signalReader;
  const conductorIntelligence = deps.conductorIntelligence;
  const V = deps.validator.create('regimeReactiveDamping');

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

  const _cc = controllerConfig.getSection('regimeReactiveDamping');
  const _BASE_MAX_DENSITY = V.optionalFinite(_cc.baseMaxDensity, 0.12);
  const _BASE_MAX_TENSION = V.optionalFinite(_cc.baseMaxTension, 0.12);
  const _BASE_MAX_FLICKER = V.optionalFinite(_cc.baseMaxFlicker, 0.17);
  const _DENSITY_RANGE = V.optionalType(_cc.densityRange, 'array', [0.88, 1.12]);
  const _TENSION_RANGE = V.optionalType(_cc.tensionRange, 'array', [0.88, 1.22]);
  const _FLICKER_RANGE = V.optionalType(_cc.flickerRange, 'array', [0.83, 1.19]);

  // Metaprofile-scaled maxima via scaleFactor (active/default profile ratio).
  // No active profile / disabled axis -> 1.0x -> _BASE constant unchanged.
  // Tension ceiling uses progressedScaleFactor so envelope-typed values
  // (e.g. tense.tension.ceiling = {from:0.70,to:0.90,curve:'ascending'})
  // resolve at the current activation progress -- ceiling rises as the
  // profile holds across sections. Scalar values short-circuit to the
  // unchanged ratio.
  function _getMaxTension() {
    return _BASE_MAX_TENSION * metaProfiles.progressedScaleFactor('tension', 'ceiling');
  }
  // Density target uses sampledScaleFactor so distribution-typed values
  // (e.g. chaotic.energy.densityTarget = {mean, std}) draw a fresh sample
  // each call -- organic per-tick density variation without manual
  // flicker. Scalar values short-circuit to deterministic ratio (no
  // perturbation), so non-distribution profiles see no behavioral change.
  function _getMaxDensity() {
    return _BASE_MAX_DENSITY * metaProfiles.sampledScaleFactor('energy', 'densityTarget');
  }
  const MAX_FLICKER = _BASE_MAX_FLICKER;

  const CURVATURE_CEILING = 1.0;

  const BIAS_SMOOTHING = V.optionalFinite(_cc.biasSmoothing, 0.20);

  const LOW_VEL_THRESHOLD = V.optionalFinite(_cc.lowVelocityThreshold, 0.015);
  const LOW_VEL_BEATS     = V.optionalFinite(_cc.lowVelocityBeats, 8);
  const DRIFT_MAGNITUDE   = V.optionalFinite(_cc.driftMagnitude, 0.22);
  const DRIFT_DECAY       = V.optionalFinite(_cc.driftDecay, 0.93);
  let lowVelStreak = 0;
  let regimeReactiveDampingDriftD = 0;
  let regimeReactiveDampingDriftT = 0;
  let regimeReactiveDampingDriftF = 0;
  let regimeReactiveDampingInjectionCount = 0;

  const _REGIME_RING_SIZE = V.optionalFinite(_cc.regimeRingSize, 64);
  /** @type {string[]} */
  const regimeReactiveDampingRegimeRing = [];
  const _DEFAULT_REGIME_BUDGET = {
    exploring: 0.35,
    coherent: 0.35,
    evolving: 0.20,
    stagnant: 0.03,
    fragmented: 0.03,
    oscillating: 0.02,
    drifting: 0.02,
  };
  // Metaprofile-aware: read targets dynamically so mid-run profile switches
  // take effect on the next tick. Minor regimes (stagnant, fragmented, etc.)
  // keep their fixed budget -- metaprofiles only configure the big three.
  function _getRegimeBudget() {
    const targets = metaProfiles.getRegimeTargets();
    if (!targets) return _DEFAULT_REGIME_BUDGET;
    return {
      exploring:   targets.exploring,
      coherent:    targets.coherent,
      evolving:    targets.evolving,
      stagnant:    _DEFAULT_REGIME_BUDGET.stagnant,
      fragmented:  _DEFAULT_REGIME_BUDGET.fragmented,
      oscillating: _DEFAULT_REGIME_BUDGET.oscillating,
      drifting:    _DEFAULT_REGIME_BUDGET.drifting,
    };
  }
  const _EQUILIB_STRENGTH = V.optionalFinite(_cc.equilibStrength, 0.28);
  let regimeReactiveDampingEqCorrD = 0;
  let regimeReactiveDampingEqCorrT = 0;
  let regimeReactiveDampingEqCorrF = 0;
  // Effectiveness tracking: if exploring share persistently exceeds budget despite corrections,
  // escalate equilibStrength by up to 50%. Resets when exploring returns to budget.
  let regimeReactiveDampingEqExcessEma = 0;
  let regimeReactiveDampingDynamicEquilibStrength = _EQUILIB_STRENGTH;

  let regimeReactiveDampingExploringBeats = 0;
  let regimeReactiveDampingTensionPinStreak = 0;
  let regimeReactiveDampingTensionUnpinStreak = 0;
  let regimeReactiveDampingTensionCeilingRelax = 0;
  const _PIN_STREAK_TRIGGER = V.optionalFinite(_cc.pinStreakTrigger, 10);
  const _UNPIN_RESET_BEATS = 5;
  const _PIN_RELAX_STEP = V.optionalFinite(_cc.pinRelaxStep, 0.05);

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

  function refresh(ctx) {
    if (ctx && ctx.layer === 'L2') return;
    const snap = systemDynamicsProfiler.getSnapshot();
    const dynamicSnap = /** @type {any} */ (snap);
    currentRegime = snap ? snap.regime : 'evolving';
    regimeReactiveDampingExploringBeats = currentRegime === 'exploring'
      ? regimeReactiveDampingExploringBeats + 1 : 0;
    const rawCurv = snap ? (V.optionalFinite(snap.curvature, 0)) : 0;
    curvatureGain = clamp(rawCurv / CURVATURE_CEILING, 0, 1);

    const equilibratorState = {
      currentRegime,
      regimeRing: regimeReactiveDampingRegimeRing,
      regimeRingSize: _REGIME_RING_SIZE,
      regimeBudget: _getRegimeBudget(),
      equilibStrength: regimeReactiveDampingDynamicEquilibStrength,
      eqCorrD: regimeReactiveDampingEqCorrD,
      eqCorrT: regimeReactiveDampingEqCorrT,
      eqCorrF: regimeReactiveDampingEqCorrF,
      snap,
      smoothedFlicker: regimeReactiveDampingSmoothedFlicker,
    };
    regimeReactiveDampingEquilibrator.compute(equilibratorState);
    // Apply watchdog attenuation so conflicting equilibrator corrections
    // self-dampen on flagged axes instead of canceling peer controllers.
    regimeReactiveDampingEqCorrD = equilibratorState.eqCorrD * conductorMetaWatchdog.getAttenuation('density', 'equilibrator');
    regimeReactiveDampingEqCorrT = equilibratorState.eqCorrT * conductorMetaWatchdog.getAttenuation('tension', 'equilibrator');
    regimeReactiveDampingEqCorrF = equilibratorState.eqCorrF * conductorMetaWatchdog.getAttenuation('flicker', 'equilibrator');
    // Effectiveness tracking: update EMA of persistent exploring excess; escalate strength if corrections fail.
    const ringLen = regimeReactiveDampingRegimeRing.length;
    const ringExpShare = ringLen > 0
      ? regimeReactiveDampingRegimeRing.filter(/** @param {string} r */ (r) => r === 'exploring').length / ringLen
      : 0;
    const expExcessNow = m.max(0, ringExpShare - _getRegimeBudget().exploring);
    regimeReactiveDampingEqExcessEma = regimeReactiveDampingEqExcessEma * 0.95 + expExcessNow * 0.05;
    regimeReactiveDampingDynamicEquilibStrength = _EQUILIB_STRENGTH * (1 + clamp(regimeReactiveDampingEqExcessEma / 0.10, 0, 0.5));

    const velocity = snap ? (V.optionalFinite(snap.velocity, 0)) : 0;
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
      const dCoup = m.abs(V.optionalFinite(cm['density-tension'], 0)) + m.abs(V.optionalFinite(cm['density-flicker'], 0));
      const tCoup = m.abs(V.optionalFinite(cm['density-tension'], 0)) + m.abs(V.optionalFinite(cm['tension-flicker'], 0));
      const fCoup = m.abs(V.optionalFinite(cm['density-flicker'], 0)) + m.abs(V.optionalFinite(cm['tension-flicker'], 0));

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
    const densityFlickerPressure = clamp((m.abs(V.optionalFinite(couplingMatrix && couplingMatrix['density-flicker'], 0)) - 0.76) / 0.18, 0, 1);
    const tensionFlickerPressure = clamp((m.abs(V.optionalFinite(couplingMatrix && couplingMatrix['tension-flicker'], 0)) - 0.76) / 0.16, 0, 1);
    const densityTrustPressure = clamp((m.abs(V.optionalFinite(couplingMatrix && couplingMatrix['density-trust'], 0)) - 0.72) / 0.18, 0, 1);
    const flickerTrustPressure = clamp((m.abs(V.optionalFinite(couplingMatrix && couplingMatrix['flicker-trust'], 0)) - 0.68) / 0.18, 0, 1);
    const axisEnergy = pipelineCouplingManager.getAxisEnergyShare();
    const axisShares = axisEnergy && axisEnergy.shares;
    const phaseShare = V.optionalFinite(axisShares && axisShares.phase, 1.0 / 6.0);
    const trustShare = V.optionalFinite(axisShares && axisShares.trust, 1.0 / 6.0);
    const signalHealth = signalHealthAnalyzer.getHealth();
    const densityHealth = signalHealth && signalHealth.density ? signalHealth.density : null;
    const lowPhaseThreshold = /** @type {number} */ (phaseFloorController.getLowShareThreshold());
    const phaseContainmentTarget = 0.09;
    const lowPhasePressure = clamp((lowPhaseThreshold - phaseShare) / m.max(lowPhaseThreshold, 0.01), 0, 1);
    const phaseRecoveryCredit = clamp((phaseShare - phaseContainmentTarget) / 0.05, 0, 1);
    const flickerPhasePressure = clamp((m.abs(V.optionalFinite(couplingMatrix && couplingMatrix['flicker-phase'], 0)) - 0.62) / 0.18, 0, 1);
    const trustSharePressure = clamp((trustShare - 0.17) / 0.08, 0, 1);
    const densitySaturationPressure = densityHealth
      ? clamp((densityHealth.saturated ? 0.45 : 0) + clamp((densityHealth.crushFactor - 0.35) / 0.40, 0, 1) * 0.55, 0, 1)
      : 0;
    const evolvingShare = V.optionalFinite(dynamicSnap && dynamicSnap.evolvingShare, 0);
    const evolvingRecoveryPressure = clamp((0.10 - evolvingShare) / 0.10, 0, 1);
    const topPairConcentration = V.optionalFinite(dynamicSnap && dynamicSnap.hotspotTop2Concentration, 0);
    const containedTailRecovery = clamp((0.78 - topPairConcentration) / 0.18, 0, 1) * (1 - densityFlickerPressure * 0.55) * (1 - tensionFlickerPressure * 0.45);
    const longFormBuildPressure = totalSections >= 5 && sectionIndex > 0 && sectionIndex < totalSections - 1 ? 1 : 0;
    const densityAxisShare = V.optionalFinite(axisShares && axisShares.density, 1.0 / 6.0);
    const densityAxisDeficit = clamp((1.0 / 6.0 - densityAxisShare) / 0.05, 0, 1);
    const regimeFlickerHotspotBrake = clamp(
      (densityFlickerPressure * 0.08 + tensionFlickerPressure * 0.12 + flickerTrustPressure * 0.10 + lowPhasePressure * 0.02 + trustSharePressure * 0.03 + densitySaturationPressure * 0.04 + flickerPhasePressure * (0.05 + phaseRecoveryCredit * 0.08) + clamp((topPairConcentration - 0.72) / 0.20, 0, 1) * 0.04) * ((currentRegime === 'exploring' || currentRegime === 'coherent') ? 1 : 0.6),
      0,
      0.20
    );
    const flickerShare = V.optionalFinite(axisShares && axisShares.flicker, 1.0 / 6.0);
    const flickerDeficit = clamp((1.0 / 6.0 - flickerShare) / 0.05, 0, 1);
    const flickerRecoveryRelief = 1.0 - flickerDeficit * 0.25;
    const adjustedFlickerHotspotBrake = regimeFlickerHotspotBrake * flickerRecoveryRelief;
    const densityHotspotBrake = clamp((densityFlickerPressure * (0.010 + phaseRecoveryCredit * 0.015) + densityTrustPressure * 0.020 + trustSharePressure * 0.022 + densitySaturationPressure * (0.032 + lowPhasePressure * 0.025) + clamp((topPairConcentration - 0.70) / 0.15, 0, 1) * densityFlickerPressure * 0.020) * (0.45 + phaseRecoveryCredit * 0.55), 0, 0.09);
    const tensionSignal = conductorState.getField('tension');
    const tensionValue = V.optionalFinite(tensionSignal, 0.5);
    const tensionRecoveryNudge = longFormBuildPressure * phaseRecoveryCredit * clamp((0.58 - tensionValue) / 0.22, 0, 1) * (1 - tensionFlickerPressure * 0.45) * 0.02;
    // R19: exploring brake strengthened. Duration-proportional component pushes
    // system toward evolving/coherent when exploring persists >100 beats.
    // Intent-aware exploring brake: soften during development/exposition where
    // exploring is a natural mode, strengthen during climax/resolution where
    // coherence is expected.
    const sectionPhaseForBrake = harmonicContext.getField('sectionPhase');
    const exploringPhaseScale = sectionPhaseForBrake === 'development' || sectionPhaseForBrake === 'exposition'
      ? 0.6
      : sectionPhaseForBrake === 'climax' || sectionPhaseForBrake === 'resolution'
      ? 1.4
      : 1.0;
    // R43 E1: triple coefficient 0.0004->0.0012, raise cap 0.08->0.10 to break 80-beat monopolies.
    const exploringDurationPressure = currentRegime === 'exploring'
      ? clamp((regimeReactiveDampingExploringBeats - 60) * 0.0012 * exploringPhaseScale, 0, 0.10) : 0;
    const exploringBiasBrake = currentRegime === 'exploring'
      ? clamp(trustSharePressure * 0.04 + densityTrustPressure * 0.015 + densitySaturationPressure * 0.04 + lowPhasePressure * 0.03 + evolvingRecoveryPressure * 0.05 + exploringDurationPressure, 0, 0.18)
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
    // Metaprofile tension shape via pure function (testable independently)
    const _arc = metaProfiles.getTensionArc();
    const _tensionShape = _arc ? _arc.shape : 'arch';
    const sectionTensionNudge = clamp(regimeReactiveDampingCore.tensionShapeCurve(_tensionShape, sectionProgress), 0, 1) * 0.045;
    const densityArchProgress = m.abs(sectionProgress - 0.5) * 2;
    const currentDensitySignal = signalReader.density();
    if (Number.isFinite(currentDensitySignal)) {
      const ds = /** @type {number} */ (currentDensitySignal);
      densityMeanEma += (ds - densityMeanEma) * _DENSITY_VAR_EMA_ALPHA;
      const densityDevSq = (ds - densityMeanEma) * (ds - densityMeanEma);
      densityVarEma += (densityDevSq - densityVarEma) * _DENSITY_VAR_EMA_ALPHA;
    }
    const densityArchScale = densityVarEma < _DENSITY_VAR_TARGET_LOW
      ? 1.0 + clamp((_DENSITY_VAR_TARGET_LOW - densityVarEma) / 0.005, 0, 1) * 0.6
      : densityVarEma > _DENSITY_VAR_TARGET_HIGH
        ? 1.0 - clamp((densityVarEma - _DENSITY_VAR_TARGET_HIGH) / 0.006, 0, 1) * 0.6
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
    const journeyBoldness = journeyRhythmCoupler.getBoldness();
    const dtCoMovementPush = journeyBoldness > 0.25
      ? clamp((journeyBoldness - 0.25) / 0.60, 0, 1) * 0.030
      : 0;
    const tensionShare = V.optionalFinite(axisShares && axisShares.tension, 1.0 / 6.0);
    const dtShareGap = clamp(tensionShare - densityShare, 0, 0.12) / 0.12;
    const dtShareBridgeLift = dtAbs > 0.45
      ? clamp((dtAbs - 0.45) / 0.35, 0, 1) * dtShareGap * 0.015
      : 0;
    const rawD = 1.0 + (V.optionalFinite(REGIME_DENSITY_DIR[currentRegime], 0)) * _getMaxDensity() * curvatureGain + regimeReactiveDampingDriftD + regimeReactiveDampingEqCorrD - densityHotspotBrake + evolvingLift * 0.5 + densityRebalanceLift + sectionDensityNudge + midSectionDensityPush - densityShareBrake + densityRecoveryLift - coherentDFBrake - dtDensityBrake + dtCoMovementPush + dtShareBridgeLift;
    const effectiveMaxTension = _getMaxTension() + regimeReactiveDampingTensionCeilingRelax;
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
    const rawT = 1.0 + (V.optionalFinite(REGIME_TENSION_DIR[currentRegime], 0)) * effectiveMaxTension * curvatureGain + regimeReactiveDampingDriftT + regimeReactiveDampingEqCorrT + sectionTensionNudge + tensionRecoveryNudge + evolvingLift + coherentToEvolvingReheat - exploringBiasBrake - tensionFlickerRelease - tensionShareBrake + boldnessTensionPush + tensionRecoveryLift2 - dtTensionTrim;
    const dfRaw = couplingMatrix ? couplingMatrix['density-flicker'] : 0;
    const dfCoupling = Number.isFinite(dfRaw) ? m.abs(dfRaw) : 0;
    const archOffset = clamp((dfCoupling - 0.35) / 0.40, 0, 1) * 0.15;
    const flickerArchCenter = 0.5 + archOffset;
    const flickerArchProgress = 1 - m.abs(sectionProgress - flickerArchCenter) * 2;
    const sectionFlickerNudge = (clamp(flickerArchProgress, 0, 1) - 0.5) * 0.04;
    const flickerShareBrake = clamp((flickerShare - 0.18) / 0.10, 0, 1) * 0.08;
    const rawF = 1.0 + (V.optionalFinite(REGIME_FLICKER_DIR[currentRegime], 0)) * MAX_FLICKER * curvatureGain + regimeReactiveDampingDriftF + regimeReactiveDampingEqCorrF - adjustedFlickerHotspotBrake + evolvingLift - exploringBiasBrake - coherentToEvolvingReheat * 0.5 - tensionFlickerRelease * 0.7 + sectionFlickerNudge - ftDecoupleBrake - flickerShareBrake;
    regimeReactiveDampingSmoothedDensity = clamp(regimeReactiveDampingSmoothedDensity * (1 - BIAS_SMOOTHING) + rawD * BIAS_SMOOTHING, _DENSITY_RANGE[0], _DENSITY_RANGE[1]);
    regimeReactiveDampingSmoothedTension = clamp(regimeReactiveDampingSmoothedTension * (1 - BIAS_SMOOTHING) + rawT * BIAS_SMOOTHING, _TENSION_RANGE[0], _TENSION_RANGE[1]);
    regimeReactiveDampingSmoothedFlicker = clamp(regimeReactiveDampingSmoothedFlicker * (1 - BIAS_SMOOTHING) + rawF * BIAS_SMOOTHING, _FLICKER_RANGE[0], _FLICKER_RANGE[1]);

    const tensionAtPin = m.abs(regimeReactiveDampingSmoothedTension - (1.0 + effectiveMaxTension)) < 0.005
                      || m.abs(regimeReactiveDampingSmoothedTension - (1.0 - effectiveMaxTension)) < 0.005;
    if (tensionAtPin) {
      regimeReactiveDampingTensionPinStreak++;
      regimeReactiveDampingTensionUnpinStreak = 0;
      if (regimeReactiveDampingTensionPinStreak > _PIN_STREAK_TRIGGER) {
        regimeReactiveDampingTensionCeilingRelax = clamp(regimeReactiveDampingTensionCeilingRelax + _getMaxTension() * _PIN_RELAX_STEP, 0, _getMaxTension() * 0.30);
        regimeReactiveDampingTensionPinStreak = 0;
        safePreBoot.call(() => explainabilityBus.emit('tension-pin-relief', 'both', {
          newCeiling: _getMaxTension() + regimeReactiveDampingTensionCeilingRelax,
          baseCeiling: _getMaxTension()
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
    regimeReactiveDampingInjectionCount = 0;
    regimeReactiveDampingExploringBeats = 0;
    densityVarEma = 0.010;
    densityMeanEma = 0.50;
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
    () => m.abs(regimeReactiveDampingSmoothedDensity - 1.0) / _getMaxDensity(),
    () => m.sign(regimeReactiveDampingSmoothedDensity - 1.0)
  );

  return { densityBias, tensionBias, flickerMod, reset };
  },
});
