

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

  // Base bias per regime (direction only; magnitude scales with curvature)
  const REGIME_DENSITY_DIR = {
    stagnant: 1,     // boost
    fragmented: 0,   // neutral
    oscillating: 0,  // neutral
    // R80 E3: Exploring density contraction. Exploring was neutral (0),
    // producing no regime-dependent density motion. Combined with coherent=0,
    // this left densityVariance stagnant at 0.0077. Setting exploring=-0.3
    // creates sparser texture during exploring passages while exploring's
    // tension direction (+1) rises, producing dramatic contrast: sparse-
    // but-tense exploring vs neutral-density coherent. This regime-dependent
    // density variation directly increases densityVariance.
    exploring: -0.3, // sparse contrast
    coherent: 0,     // neutral
    evolving: 0,     // neutral
    drifting: -1,    // suppress
  };

  // R6 E3 + R7 E1: Tension regime biases. Coherent reverted to 0 (R6 coherent=-0.5
  // flattened ascending arc to plateau). Stagnant/evolving +0.5 retained but rare.
  const REGIME_TENSION_DIR = {
    stagnant: 0.5,     // mild boost to break stagnation
    fragmented: 0,
    oscillating: 0,
    exploring: 1,
    coherent: 0,       // R91 E2: reverted to 0. DT pearsonR spiked 0.1247->0.4437 in R90 with 0.15; density and tension move in sync during coherent passages, creating exceedance (38 beats). Neutral decorrelates them.
    evolving: 1.3,     // R33 E4: 0.5->1.0. R1 E2: 1.0->1.3 tension axis collapsed to 0.119 (29% below fair share). Evolving at 24.5% needs stronger tension contribution.
    drifting: 1,
  };

  const REGIME_FLICKER_DIR = {
    stagnant: 1,     // boost
    fragmented: -1,  // dampen
    oscillating: 0,  // neutral (was -1 - dampening flicker while density is neutral
                     //   created mechanical anti-correlation r=-0.7 via shared causal path)
    // R87 E5: Exploring flicker enrichment. Exploring is now 37.6%
    // (dominant non-coherent regime). Boosting flicker direction from
    // 1->1.5 creates more dynamic timbral variation during exploring,
    // giving exploring passages a distinctive animated texture.
    // R93 E1: Moderated 1.5->1.2. FT pearsonR improved 0.5269->0.4284
    // but regime collapsed: exploring 41.1%->17.7%, coherent 49.1%->74.4%.
    // R94 E1: Compromise 1.35. 1.2 was too low (collapsed exploring via
    // insufficient dimensional variance). 1.5 was too high (FT correlation).
    // 1.35 should balance FT decorrelation with regime diversity.
    exploring: 1.35,  // boost variation - inject independent flicker to reduce density-flicker coupling
    coherent: 0,     // neutral - suppression (was -1) compressed flicker range and inflated coupling via near-zero variance
    evolving: 0.5,  // R33 E4: 0->0.5 give evolving regime distinct timbral character
    drifting: 0,
  };

  // Max bias magnitude per signal (how far from 1.0 we can go)
  const MAX_DENSITY = 0.12;  // - range 0.88-1.12
  const MAX_TENSION = 0.12;  // R26 E2->R97 E5: Widened 0.06->0.10->0.12 for tension expressiveness (range 0.88-1.12)
  const MAX_FLICKER = 0.20;  // R28 E4: Widened from 0.15 for more timbral variety across regimes
  const _DENSITY_RANGE = [0.88, 1.12];
  const _TENSION_RANGE = [0.88, 1.22];  // R26 E2: widened to match MAX_TENSION=0.10
  const _FLICKER_RANGE = [0.82, 1.22];  // R28 E4: widened to match MAX_FLICKER=0.20

  // Curvature scaling: bias = 1 + dir * max * curvatureGain
  // At curvature 0 - bias = 1.0 (neutral). At curvature 1.0 - full magnitude.
  const CURVATURE_CEILING = 1.0;

  // EMA smoothing on bias outputs - prevents discontinuous jumps on regime
  // transitions that feed back as self-induced oscillation via the profiler.
  const BIAS_SMOOTHING = 0.20;

  // Velocity floor: detect phase-space stasis and inject directional drift
  // When velocity stays below threshold for LOW_VEL_BEATS, nudge the least-active
  // axis to restart trajectory movement. This addresses the "near-zero velocity
  // despite evolving regime" problem - the system equilibrates too fast.
  const LOW_VEL_THRESHOLD = 0.015;
  const LOW_VEL_BEATS     = 8;
  const DRIFT_MAGNITUDE   = 0.14;   // R29 E2: Raised from 0.09 for more dramatic stasis breakouts
  const DRIFT_DECAY       = 0.93; // drift decays each beat, replaced when velocity recovers
  let lowVelStreak = 0;
  let regimeReactiveDampingDriftD = 0;
  let regimeReactiveDampingDriftT = 0;
  let regimeReactiveDampingDriftF = 0;
  let regimeReactiveDampingInjectionCount = 0; // persistent counter for sign alternation (survives streak resets)

  // -- #2: Regime Distribution Equilibrator (Hypermeta) --
  // Tracks regime occurrences in a rolling window and auto-modulates bias
  // to steer the distribution toward target budget. When a regime dominates
  // (e.g. exploring 71%), the equilibrator counteracts the biases that
  // encourage it, eliminating manual regime-bias re-tuning between rounds.
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
  const _EQUILIB_STRENGTH = 0.25;
  let regimeReactiveDampingEqCorrD = 0;
  let regimeReactiveDampingEqCorrT = 0;
  let regimeReactiveDampingEqCorrF = 0;

  // -- #7 (R7): Tension Pin Relief Valve --
  // When tension bias pins at its ceiling for >10 consecutive beats,
  // temporarily relax the ceiling by 5% to prevent sustained saturation.
  // Resets after 5 beats of non-pinned output.
  let regimeReactiveDampingTensionPinStreak = 0;
  let regimeReactiveDampingTensionUnpinStreak = 0;
  let regimeReactiveDampingTensionCeilingRelax = 0;  // additive relaxation on MAX_TENSION
  const _PIN_STREAK_TRIGGER = 10;
  const _UNPIN_RESET_BEATS = 5;
  const _PIN_RELAX_STEP = 0.05;  // 5% of MAX_TENSION per trigger

  let currentRegime = 'evolving';
  let curvatureGain = 0;
  let regimeReactiveDampingSmoothedDensity = 1.0;
  let regimeReactiveDampingSmoothedTension = 1.0;
  let regimeReactiveDampingSmoothedFlicker = 1.0;

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

    // Velocity floor logic
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
      // Find the axis with weakest absolute correlation to others -
      // perturbing it has the least chance of cascading through coupling.
      const cm = snap.couplingMatrix;
      const dCoup = m.abs(cm['density-tension'] || 0) + m.abs(cm['density-flicker'] || 0);
      const tCoup = m.abs(cm['density-tension'] || 0) + m.abs(cm['tension-flicker'] || 0);
      const fCoup = m.abs(cm['density-flicker'] || 0) + m.abs(cm['tension-flicker'] || 0);

      // Directional: alternate sign using persistent counter to prevent
      // monotonic drift. regimeReactiveDampingInjectionCount survives streak resets and section
      // resets, ensuring true alternation across the full composition.
      regimeReactiveDampingInjectionCount++;
      const sign = (regimeReactiveDampingInjectionCount % 2 === 0) ? 1 : -1;

      if (dCoup <= tCoup && dCoup <= fCoup) {
        regimeReactiveDampingDriftD = sign * DRIFT_MAGNITUDE;
      } else if (tCoup <= fCoup) {
        regimeReactiveDampingDriftT = sign * DRIFT_MAGNITUDE;
      } else {
        regimeReactiveDampingDriftF = sign * DRIFT_MAGNITUDE;
      }
      // Reset streak so drift is injected once per LOW_VEL_BEATS window
      lowVelStreak = 0;
    }

    const couplingMatrix = snap ? snap.couplingMatrix : null;
    const densityFlickerPressure = couplingMatrix && typeof couplingMatrix['density-flicker'] === 'number' && Number.isFinite(couplingMatrix['density-flicker'])
      ? clamp((m.abs(couplingMatrix['density-flicker']) - 0.76) / 0.18, 0, 1)
      : 0;
    const tensionFlickerPressure = couplingMatrix && typeof couplingMatrix['tension-flicker'] === 'number' && Number.isFinite(couplingMatrix['tension-flicker'])
      ? clamp((m.abs(couplingMatrix['tension-flicker']) - 0.76) / 0.16, 0, 1)
      : 0;
    const flickerTrustPressure = couplingMatrix && typeof couplingMatrix['flicker-trust'] === 'number' && Number.isFinite(couplingMatrix['flicker-trust'])
      ? clamp((m.abs(couplingMatrix['flicker-trust']) - 0.74) / 0.18, 0, 1)
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
      ? clamp((m.abs(couplingMatrix['flicker-phase']) - 0.74) / 0.14, 0, 1)
      : 0;
    const trustSharePressure = clamp((trustShare - 0.17) / 0.08, 0, 1);
    const densitySaturationPressure = densityHealth
      ? clamp((densityHealth.saturated ? 0.45 : 0) + clamp((densityHealth.crushFactor - 0.35) / 0.40, 0, 1) * 0.55, 0, 1)
      : 0;
    const evolvingShare = dynamicSnap && typeof dynamicSnap.evolvingShare === 'number'
      ? dynamicSnap.evolvingShare
      : 0;
    const evolvingRecoveryPressure = clamp((0.055 - evolvingShare) / 0.055, 0, 1);
    const topPairConcentration = dynamicSnap && typeof dynamicSnap.hotspotTop2Concentration === 'number'
      ? dynamicSnap.hotspotTop2Concentration
      : 0;
    const longFormBuildPressure = totalSections >= 5 && sectionIndex > 0 && sectionIndex < totalSections - 1 ? 1 : 0;
    const regimeFlickerHotspotBrake = clamp(
      (densityFlickerPressure * 0.08 + tensionFlickerPressure * 0.10 + flickerTrustPressure * 0.07 + lowPhasePressure * 0.02 + trustSharePressure * 0.03 + densitySaturationPressure * 0.04 + flickerPhasePressure * (0.03 + phaseRecoveryCredit * 0.07) + clamp((topPairConcentration - 0.72) / 0.20, 0, 1) * 0.04) * ((currentRegime === 'exploring' || currentRegime === 'coherent') ? 1 : 0.6),
      0,
      0.20
    );
    // R69 E3 / R70 E1: Flicker axis recovery relief. When flicker is below
    // fair share, reduce the hotspot brake proportionally to how far below
    // fair share flicker is. R69 used a binary 0.60 threshold at 0.155
    // which overcorrected (flicker spiked 0.1486 -> 0.2367). Now uses
    // proportional scaling: up to 25% brake reduction, scaled by deficit.
    const flickerShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.flicker === 'number'
      ? axisEnergy.shares.flicker
      : 1.0 / 6.0;
    const flickerDeficit = clamp((1.0 / 6.0 - flickerShare) / 0.05, 0, 1);
    const flickerRecoveryRelief = 1.0 - flickerDeficit * 0.25;
    const adjustedFlickerHotspotBrake = regimeFlickerHotspotBrake * flickerRecoveryRelief;
    const densityHotspotBrake = clamp((densityFlickerPressure * (0.010 + phaseRecoveryCredit * 0.015) + trustSharePressure * 0.015 + densitySaturationPressure * (0.030 + lowPhasePressure * 0.020)) * (0.45 + phaseRecoveryCredit * 0.55), 0, 0.07);
    const tensionSignal = safePreBoot.call(() => conductorState.getField('tension'), null);
    const tensionValue = typeof tensionSignal === 'number' && Number.isFinite(tensionSignal)
      ? tensionSignal
      : 0.5;
    const tensionRecoveryNudge = longFormBuildPressure * phaseRecoveryCredit * clamp((0.58 - tensionValue) / 0.22, 0, 1) * (1 - tensionFlickerPressure * 0.45) * 0.02;
    const exploringBiasBrake = currentRegime === 'exploring'
      ? clamp(trustSharePressure * 0.04 + densitySaturationPressure * 0.04 + lowPhasePressure * 0.03 + evolvingRecoveryPressure * 0.05, 0, 0.12)
      : 0;
    const evolvingLift = currentRegime === 'evolving'
      ? clamp((1 - densityFlickerPressure) * 0.02 + lowPhasePressure * 0.04 + trustSharePressure * 0.02 + evolvingRecoveryPressure * 0.04 + phaseRecoveryCredit * 0.02, 0, 0.08)
      : 0;
    const coherentToEvolvingReheat = currentRegime === 'coherent'
      ? clamp(evolvingRecoveryPressure * 0.03 + phaseRecoveryCredit * 0.015 - densityFlickerPressure * 0.01 - tensionFlickerPressure * 0.018, 0, 0.04)
      : 0;
    // R72 E4: Tension-flicker monopoly relief. R71 showed tension-flicker
    // at 55/60 exceedance beats (92%), worst hotspot concentration ever.
    // Raised ceiling 0.08->0.12 and added monopoly penalty when top pair
    // concentration > 0.80 AND tension-flicker is the pressured pair.
    const tensionFlickerRelease = clamp(tensionFlickerPressure * (0.045 + evolvingRecoveryPressure * 0.02 + phaseRecoveryCredit * 0.015) * ((currentRegime === 'coherent' || currentRegime === 'evolving') ? 1 : 0.7) + clamp((topPairConcentration - 0.80) / 0.15, 0, 1) * tensionFlickerPressure * 0.04, 0, 0.12);
    const densityRebalanceLift = clamp(tensionFlickerPressure * (0.015 + phaseRecoveryCredit * 0.01) * (1 - densityFlickerPressure * 0.6), 0, 0.03);
    // R2 E4: Bidirectional flicker-trust brake. Currently only flicker is
    // suppressed when FT correlation is high (0.4358 pearsonR in R1).
    // Break the coupling at both ends: when flicker-trust coupling exceeds
    // the threshold, also read the DF coupling to shift the flicker arch.
    const ftRaw = couplingMatrix ? couplingMatrix['flicker-trust'] : 0;
    const flickerTrustCoupling = Number.isFinite(ftRaw) ? m.abs(ftRaw) : 0;
    // R4 E4: Strengthen ftDecoupleBrake. FT pearsonR resurgent at 0.4317
    // in R3 despite R2's 0.025 max brake. Raise to 0.04 for stronger
    // FT decorrelation pressure.
    const ftDecoupleBrake = clamp((flickerTrustCoupling - 0.40) / 0.30, 0, 1) * 0.04;

    // Compute raw bias values with equilibrator corrections (#2)
    // R8 E3: Section-progressive tension bias. Adds a small ascending nudge
    // across sections to prevent V-shaped tension arc [0.44, 0.62, 0.43, 0.43].
    // R93 E2: Hill-shaped section tension nudge. Linear ramp (0->0.03) pushed
    // tension monotonically toward later sections. Replace with sinusoidal
    // arch (peak at mid-composition, ~0.035) creating natural tension climax
    // at the compositional midpoint, then relaxation. This matches the
    // flicker arch (hill-shaped) and complements the density arch (V-shaped),
    // creating a more musically natural tension trajectory.
    const sectionProgress = clamp(sectionIndex / m.max(1, totalSections - 1), 0, 1);
    const sectionTensionNudge = m.sin(sectionProgress * m.PI) * 0.045;
    // R81 E3: Section-level density arch. densityVariance has been declining
    // (0.0077->0.0054) because density is nearly uniform across sections.
    // Add V-shaped modulation: denser at composition boundaries, sparser at
    // midpoint. This creates structural density variation independent of
    // regime, complementing the tension arch (which peaks at midpoint).
    const densityArchProgress = m.abs(sectionProgress - 0.5) * 2; // 0 at mid, 1 at edges
    const sectionDensityNudge = (densityArchProgress - 0.5) * 0.06; // range [-0.03, +0.03]
    // R85 E2 + R86 E1: Density axis containment. When density axis exceeds
    // fair share (0.167), apply graduated density brake. R86: threshold
    // raised 0.18->0.20 because R85 overcorrected density to 0.1483
    // (below fair share). Higher threshold ensures brake only fires on
    // clear overshare, not near-fair-share fluctuations.
    const densityShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.density === 'number'
      ? axisEnergy.shares.density
      : 1.0 / 6.0;
    // R1 E4: Tighten density brake. Density dominant at 0.219 (31% above
    // fair share). Lower threshold 0.20->0.18 so brake engages earlier.
    const densityShareBrake = clamp((densityShare - 0.18) / 0.08, 0, 1) * 0.04;
    // R89 E1 / R90 E1: Density axis recovery lift. When density is below
    // fair share, apply proportional positive nudge. R89 at 0.03 overcorrected
    // density +74% (0.1325->0.2304). R90: reduced to 0.01 for gentler recovery.
    const densityDeficit = clamp((1.0 / 6.0 - densityShare) / 0.05, 0, 1);
    const densityRecoveryLift = densityDeficit * 0.01;
    const rawD = 1.0 + (REGIME_DENSITY_DIR[currentRegime] || 0) * MAX_DENSITY * curvatureGain + regimeReactiveDampingDriftD + regimeReactiveDampingEqCorrD - densityHotspotBrake + evolvingLift * 0.5 + densityRebalanceLift + sectionDensityNudge - densityShareBrake + densityRecoveryLift;
    // #7 (R7): Tension pin relief valve - track pinning and relax ceiling
    const effectiveMaxTension = MAX_TENSION + regimeReactiveDampingTensionCeilingRelax;
    // R91 E3: Tension share brake. Tension axis surged to 0.2316 (dominant),
    // creating DT exceedance monopoly (38 beats). Mirrors density share brake
    // logic: activates above 0.20, full 0.04 brake at 0.28.
    const tensionShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.tension === 'number'
      ? axisEnergy.shares.tension
      : 1.0 / 6.0;
    const tensionShareBrake = clamp((tensionShare - 0.20) / 0.08, 0, 1) * 0.04;
    const rawT = 1.0 + (REGIME_TENSION_DIR[currentRegime] || 0) * effectiveMaxTension * curvatureGain + regimeReactiveDampingDriftT + regimeReactiveDampingEqCorrT + sectionTensionNudge + tensionRecoveryNudge + evolvingLift + coherentToEvolvingReheat - exploringBiasBrake - tensionFlickerRelease - tensionShareBrake;
    // R83 E4: Section-level flicker arch -- inverted from density arch.
    // Density is V-shaped (edges dense, midpoint sparse). Flicker arch is
    // hill-shaped (edges calm, midpoint active). This creates complementary
    // section-level texture: dense+calm boundaries, sparse+flickery midpoint.
    // Range: [-0.02, +0.02], additive to raw flicker bias.
    // R2 E5: DF-coupling-responsive flicker arch offset. When density-flicker
    // correlation is high, shift the flicker arch peak away from density
    // concentration zones. Density is V-shaped (high at edges), so when DF
    // coupling is hot, push flicker peak LATER in the section to decorrelate.
    const dfRaw = couplingMatrix ? couplingMatrix['density-flicker'] : 0;
    const dfCoupling = Number.isFinite(dfRaw) ? m.abs(dfRaw) : 0;
    const archOffset = clamp((dfCoupling - 0.35) / 0.40, 0, 1) * 0.15; // up to 0.15 rightward shift
    const flickerArchCenter = 0.5 + archOffset; // shifted peak
    const flickerArchProgress = 1 - m.abs(sectionProgress - flickerArchCenter) * 2; // peak at shifted center
    const sectionFlickerNudge = (clamp(flickerArchProgress, 0, 1) - 0.5) * 0.04;
    const rawF = 1.0 + (REGIME_FLICKER_DIR[currentRegime] || 0) * MAX_FLICKER * curvatureGain + regimeReactiveDampingDriftF + regimeReactiveDampingEqCorrF - adjustedFlickerHotspotBrake + evolvingLift - exploringBiasBrake - coherentToEvolvingReheat * 0.5 - tensionFlickerRelease * 0.7 + sectionFlickerNudge - ftDecoupleBrake;
    regimeReactiveDampingSmoothedDensity = clamp(regimeReactiveDampingSmoothedDensity * (1 - BIAS_SMOOTHING) + rawD * BIAS_SMOOTHING, _DENSITY_RANGE[0], _DENSITY_RANGE[1]);
    regimeReactiveDampingSmoothedTension = clamp(regimeReactiveDampingSmoothedTension * (1 - BIAS_SMOOTHING) + rawT * BIAS_SMOOTHING, _TENSION_RANGE[0], _TENSION_RANGE[1]);
    regimeReactiveDampingSmoothedFlicker = clamp(regimeReactiveDampingSmoothedFlicker * (1 - BIAS_SMOOTHING) + rawF * BIAS_SMOOTHING, _FLICKER_RANGE[0], _FLICKER_RANGE[1]);

    // #7 (R7): Update tension pin relief valve state
    const tensionAtPin = m.abs(regimeReactiveDampingSmoothedTension - (1.0 + effectiveMaxTension)) < 0.005
                      || m.abs(regimeReactiveDampingSmoothedTension - (1.0 - effectiveMaxTension)) < 0.005;
    if (tensionAtPin) {
      regimeReactiveDampingTensionPinStreak++;
      regimeReactiveDampingTensionUnpinStreak = 0;
      if (regimeReactiveDampingTensionPinStreak > _PIN_STREAK_TRIGGER) {
        regimeReactiveDampingTensionCeilingRelax = clamp(regimeReactiveDampingTensionCeilingRelax + MAX_TENSION * _PIN_RELAX_STEP, 0, MAX_TENSION * 0.30);
        regimeReactiveDampingTensionPinStreak = 0; // reset so next trigger needs another streak
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

    // Decay drift contribution
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
    // Drift state intentionally NOT reset on section boundaries.
    // The profiler (scope 'all') retains trajectory history across sections,
    // so drift must persist to maintain momentum. lowVelStreak resets to
    // allow re-detection in the new section, but accumulated drift and
    // injection count carry forward.
    lowVelStreak = 0;
    // #2: Reset equilibrator ring buffer on section boundary
    regimeReactiveDampingRegimeRing.length = 0;
    regimeReactiveDampingEqCorrD = 0;
    regimeReactiveDampingEqCorrT = 0;
    regimeReactiveDampingEqCorrF = 0;
    // #7: Reset relief valve
    regimeReactiveDampingTensionPinStreak = 0;
    regimeReactiveDampingTensionUnpinStreak = 0;
    regimeReactiveDampingTensionCeilingRelax = 0;
  }

  // Self-registration
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
