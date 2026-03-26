

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
    // R20 E2: Moderated -0.3 -> -0.15. With exploring at 45.5%, the
    // extreme sparsity direction pushes too many beats away from coherent
    // thresholds. More moderate exploring-density retains contrast while
    // reducing regime imbalance pressure.
    // R21 E1: Fine-tuned -0.15 -> -0.22. R20 overshot coherent to 55.5%
    // (target 35%). Midpoint between -0.30 (exploring=45.5%) and -0.15
    // (coherent=55.5%) should converge on ~35-40% coherent.
    // R30 E2: Moderated -0.22 -> -0.16. Exploring has been below budget
    // (0.35) for 3 of last 4 rounds. Less density suppression during
    // exploring reduces the regime's sparsity penalty, helping beats stay
    // in exploring longer and recovering density axis share (0.123 lowest).
    // R31 E1: Adjusted -0.16 -> -0.19. R30 overshot exploring to 44.5%
    // (target 35%). Split the difference to converge on ~35%.
    // R70 E3: Moderate exploring density suppression -0.19->-0.10.
    // Exploring at 29.6% of beats -- at -0.19, this is the dominant
    // density-suppressing force. Reducing suppression lets more natural
    // density variance emerge during exploring, targeting recovery from
    // 0.0097 toward 0.019 baseline.
    // R72 E3: Restore exploring density suppression -0.10->-0.15.
    // R70 lightened from -0.19 to -0.10, but evolving collapsed to 11.9%
    // in R71. Modest suppression during exploring creates more
    // density contrast, which helps beats transition out of exploring
    // into evolving via the density-velocity pathway.
    exploring: -0.15, // moderate sparse contrast (R72 E3)
    coherent: 0.15,     // R72 E1: Revert 0.22->0.15. R71 showed 0.22 REFUTED --
    // reduced density variance 0.0132->0.0108 and drove exceedance (DT 44 beats).
    // 0.15 was the proven value from R33 E2.
    // R10 E2: Evolving density +0.3 REFUTED R11 -- entropy collapsed
    // 0.203->0.123 (-39%), entropy-trust correlation surged to 0.520.
    // Dense evolving passages suppressed entropy via density-entropy
    // coupling. Reverted to neutral (0).
    // R34 E4: 0->0.1. Much lighter than refuted +0.3 (R10). Evolving at
    // 21.5% with density=0 creates texturally neutral passages. Small
    // positive nudge adds richness without entropy collapse risk.
    evolving: 0.1,     // mild positive (R34 E4)
    drifting: -1,    // suppress
  };

  // R6 E3 + R7 E1: Tension regime biases. Coherent reverted to 0 (R6 coherent=-0.5
  // flattened ascending arc to plateau). Stagnant/evolving +0.5 retained but rare.
  const REGIME_TENSION_DIR = {
    stagnant: 0.5,     // mild boost to break stagnation
    fragmented: 0,
    oscillating: 0,
    // R31 E2: Raise exploring tension 1.0->1.15. With exploring at 44.5%
    // (R30), exploring passages need to carry more tension to maintain the
    // tension arc quality. This enriches exploring without changing regime balance.
    // R71 E4: Exploring tension 1.15->1.25. Exploring at 31.2% of beats;
    // stronger tension during exploring creates more dramatic contrast vs
    // coherent passages, enriching the tension arc.
    exploring: 1.25,
    coherent: 0.2,       // R32 E3: 0->0.3. R33 E1: 0.3->0.2. At 0.3, TF exceedance spiked to 37 beats and DT anti-correlation deepened -0.562->-0.717. Moderate to 0.2 to preserve tension arc gains while reducing side effects.
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
    // R23 E2: 0->-0.15. FT r=0.57 in R22 (increasing). During coherent,
    // flicker and trust tend to co-move (both stabilize). Light flicker
    // dampening decorrelates them by reducing flicker while trust stays high.
    // Mild enough to avoid the R93 flicker-range compression (that was -1).
    coherent: -0.15, // R23 E2: light dampen for FT decorrelation
    evolving: 0.7,  // R71 E3: 0.5->0.7. Evolving at 28.8% needs more distinct flicker
    // texture. Stronger flicker during evolving creates timbral variety vs coherent.
    drifting: 0,
  };

  // Max bias magnitude per signal (how far from 1.0 we can go)
  const MAX_DENSITY = 0.12;  // - range 0.88-1.12
  const MAX_TENSION = 0.12;  // R26 E2->R97 E5: Widened 0.06->0.10->0.12 for tension expressiveness (range 0.88-1.12)
  // R22 E1: 0.20->0.17. Flicker axis dominant at 0.2135 (fair share 0.167).
  // Exploring DIR 1.35 * MAX 0.20 = 0.27 peak bias was too strong. 1.35 * 0.17
  // = 0.23 preserves regime texture while reducing flicker energy dominance.
  // Does NOT touch REGIME_FLICKER_DIR (R93 collapse risk) - only the magnitude.
  const MAX_FLICKER = 0.17;  // R28 E4: 0.15->0.20, R22 E1: 0.20->0.17
  const _DENSITY_RANGE = [0.88, 1.12];
  const _TENSION_RANGE = [0.88, 1.22];  // R26 E2: widened to match MAX_TENSION=0.10
  const _FLICKER_RANGE = [0.83, 1.19];  // R22 E1: narrowed to match MAX_FLICKER=0.17

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
  // R70 E5: Raise DRIFT_MAGNITUDE 0.14->0.22. Stronger velocity-floor
  // breakouts inject larger density discontinuities during stasis,
  // directly boosting density variance from 0.0097.
  const DRIFT_MAGNITUDE   = 0.22;
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
  const _EQUILIB_STRENGTH = 0.28;
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

  // R76 E5: Density variance self-calibrating arch (#17). Tracks running
  // density variance via EMA and auto-scales the section density arch
  // magnitude when variance drifts from target band [0.009, 0.014].
  // 4-round decline (0.0129->0.0111->0.0094->0.0077) shows the fixed
  // 0.04 coefficient cannot adapt to changing coupling dynamics.
  let densityVarEma = 0.010;  // initial estimate
  let densityMeanEma = 0.50;  // initial density mean estimate
  const _DENSITY_VAR_EMA_ALPHA = 0.008;  // slow EMA for variance
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
    // R61 E1: Explicit density-trust hotspot sensing. After R60 dispersed the
    // DF/TF monopoly, density-trust became the top hotspot (15 beats) without
    // a dedicated structural brake.
    const densityTrustPressure = couplingMatrix && typeof couplingMatrix['density-trust'] === 'number' && Number.isFinite(couplingMatrix['density-trust'])
      ? clamp((m.abs(couplingMatrix['density-trust']) - 0.72) / 0.18, 0, 1)
      : 0;
    // R60 E3: Engage FT hotspot pressure earlier. Directly strengthening the
    // dedicated FT brake was refuted in R59. Instead, fold FT into the
    // broader flicker hotspot brake path sooner.
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
    // R15 E2: Lower FP threshold 0.74->0.62, divisor 0.14->0.18 to catch
    // moderate FP coupling (p90=0.722). Flicker-phase pearsonR 0.595 (increasing).
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
    // R16 E1: Raise threshold 0.055->0.10. At 9.3% evolving (0.093), the
    // original threshold (0.055) didn't fire -- recovery pressure was zero
    // despite evolving being well below 20% budget.
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
      // R15 E2: FP weight raised 0.03+0.07 -> 0.05+0.08 for stronger flicker-phase decorrelation
      (densityFlickerPressure * 0.08 + tensionFlickerPressure * 0.12 + flickerTrustPressure * 0.10 + lowPhasePressure * 0.02 + trustSharePressure * 0.03 + densitySaturationPressure * 0.04 + flickerPhasePressure * (0.05 + phaseRecoveryCredit * 0.08) + clamp((topPairConcentration - 0.72) / 0.20, 0, 1) * 0.04) * ((currentRegime === 'exploring' || currentRegime === 'coherent') ? 1 : 0.6),
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
    // R58 E4: Tail-concentration relief. R57 restored acceptable DF/TF
    // correlations but exceedance exploded because DF/TF remained the top
    // tail pairs. Add concentration-sensitive density braking so hotspot
    // containment reacts to pair dominance, not just raw correlation.
    // R59 E4: Spillover-aware density hotspot relief. After R58 broke the
    // DF/TF monopoly, pressure migrated into density-trust and density-phase.
    // Increase density braking when trust/phase stress is already elevated so
    // overflow does not simply move to another density surface.
    // R61 E2: Feed density-trust pressure into the density hotspot brake so
    // migrated trust-side density tails are contained at the same structural
    // layer that solved the DF/TF monopoly.
    const densityHotspotBrake = clamp((densityFlickerPressure * (0.010 + phaseRecoveryCredit * 0.015) + densityTrustPressure * 0.020 + trustSharePressure * 0.022 + densitySaturationPressure * (0.032 + lowPhasePressure * 0.025) + clamp((topPairConcentration - 0.70) / 0.15, 0, 1) * densityFlickerPressure * 0.020) * (0.45 + phaseRecoveryCredit * 0.55), 0, 0.09);
    const tensionSignal = safePreBoot.call(() => conductorState.getField('tension'), null);
    const tensionValue = typeof tensionSignal === 'number' && Number.isFinite(tensionSignal)
      ? tensionSignal
      : 0.5;
    const tensionRecoveryNudge = longFormBuildPressure * phaseRecoveryCredit * clamp((0.58 - tensionValue) / 0.22, 0, 1) * (1 - tensionFlickerPressure * 0.45) * 0.02;
    // R61 E3: When density-trust is hot during exploring, bias away from
    // density a bit sooner so the hotspot does not rebuild in the freer regime.
    const exploringBiasBrake = currentRegime === 'exploring'
      ? clamp(trustSharePressure * 0.04 + densityTrustPressure * 0.015 + densitySaturationPressure * 0.04 + lowPhasePressure * 0.03 + evolvingRecoveryPressure * 0.05, 0, 0.12)
      : 0;
    // R59 E1: Restore evolving share. R58 pushed evolving back down to 19.9%
    // after the R57 recovery to 31.0%. Increase the in-regime lift and the
    // coherent-to-evolving reheat slightly without reopening the DF/TF tail.
    const evolvingLift = currentRegime === 'evolving'
      ? clamp((1 - densityFlickerPressure) * 0.02 + lowPhasePressure * 0.04 + trustSharePressure * 0.02 + evolvingRecoveryPressure * 0.05 + phaseRecoveryCredit * 0.03 + containedTailRecovery * (0.025 + longFormBuildPressure * 0.01), 0, 0.12)
      : 0;
    const coherentToEvolvingReheat = currentRegime === 'coherent'
      // R16 E1: Raise max 0.04->0.06 for stronger cross-regime push when
      // evolving is deeply suppressed (9.3% in R15 vs 20% budget).
      ? clamp(evolvingRecoveryPressure * 0.045 + phaseRecoveryCredit * 0.018 + containedTailRecovery * 0.018 - densityFlickerPressure * 0.008 - tensionFlickerPressure * 0.018, 0, 0.08)
      : 0;
    // R72 E4: Tension-flicker monopoly relief. R71 showed tension-flicker
    // at 55/60 exceedance beats (92%), worst hotspot concentration ever.
    // Raised ceiling 0.08->0.12 and added monopoly penalty when top pair
    // concentration > 0.80 AND tension-flicker is the pressured pair.
    // R58 E4: Engage this relief earlier. In R57 top2 concentration hit
    // 0.759 while TF alone still reached 50 exceedance beats. Lower the
    // concentration gate and slightly raise the cap so the signal brake can
    // respond before a full monopoly develops.
    const tensionFlickerRelease = clamp(tensionFlickerPressure * (0.045 + evolvingRecoveryPressure * 0.02 + phaseRecoveryCredit * 0.015 + densityAxisDeficit * 0.02) * ((currentRegime === 'coherent' || currentRegime === 'evolving') ? 1 : 0.7) + clamp((topPairConcentration - 0.68) / 0.13, 0, 1) * tensionFlickerPressure * 0.07 + densityAxisDeficit * tensionFlickerPressure * 0.05, 0, 0.18);
    const densityRebalanceLift = clamp(tensionFlickerPressure * (0.015 + phaseRecoveryCredit * 0.01 + densityAxisDeficit * 0.012) * (1 - densityFlickerPressure * 0.6), 0, 0.04);
    // R2 E4: Bidirectional flicker-trust brake. Currently only flicker is
    // suppressed when FT correlation is high (0.4358 pearsonR in R1).
    // Break the coupling at both ends: when flicker-trust coupling exceeds
    // the threshold, also read the DF coupling to shift the flicker arch.
    const ftRaw = couplingMatrix ? couplingMatrix['flicker-trust'] : 0;
    const flickerTrustCoupling = Number.isFinite(ftRaw) ? m.abs(ftRaw) : 0;
    // R4 E4: Strengthen ftDecoupleBrake. FT pearsonR resurgent at 0.4317
    // in R3 despite R2's 0.025 max brake. Raise to 0.04 for stronger
    // FT decorrelation pressure.
    // R23 E1: 0.04->0.06. FT r=0.57 in R22 despite brake being active.
    // At r=0.57, old brake was 0.023 -- insufficient. New max 0.06 gives
    // 0.034 at r=0.57, stronger decorrelation pressure.
    // R59 E2: Start earlier and slightly stronger. R58 FT rebounded to
    // +0.377 after the R57 recovery to -0.074, so the structural brake needs
    // to engage before FT fully re-entrenches.
    // R60 E3: Revert the direct FT brake to 0.40/0.06. The stronger direct
    // brake was refuted; FT control now comes from the broader flicker hotspot
    // path above.
    const ftDecoupleBrake = clamp((flickerTrustCoupling - 0.40) / 0.30, 0, 1) * 0.06;

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
    // R76 E5: Self-calibrating density arch. Track running density variance
    // and auto-scale arch magnitude to maintain target band [0.009, 0.014].
    const currentDensitySignal = safePreBoot.call(() => signalReader.density(), null);
    if (typeof currentDensitySignal === 'number' && Number.isFinite(currentDensitySignal)) {
      densityMeanEma += (currentDensitySignal - densityMeanEma) * _DENSITY_VAR_EMA_ALPHA;
      const densityDevSq = (currentDensitySignal - densityMeanEma) * (currentDensitySignal - densityMeanEma);
      densityVarEma += (densityDevSq - densityVarEma) * _DENSITY_VAR_EMA_ALPHA;
    }
    // Scale arch: boost up to 2.0x when variance is low, reduce to 0.6x when high
    const densityArchScale = densityVarEma < _DENSITY_VAR_TARGET_LOW
      ? 1.0 + clamp((_DENSITY_VAR_TARGET_LOW - densityVarEma) / 0.005, 0, 1)
      : densityVarEma > _DENSITY_VAR_TARGET_HIGH
        ? 1.0 - clamp((densityVarEma - _DENSITY_VAR_TARGET_HIGH) / 0.006, 0, 1) * 0.4
        : 1.0;
    // R48 E3: Reduce V-shape amplitude 0.06->0.04 and add co-movement
    // compensation. R76 E5: now scaled by densityArchScale.
    const sectionDensityNudge = (densityArchProgress - 0.5) * 0.04 * densityArchScale; // base [-0.020, +0.020], scaled
    // R48 E3: Section-level DT co-movement nudge. At mid-composition
    // (where tension peaks), push density slightly upward to align with
    // tension. This directly fights the structural DT anti-correlation
    // caused by opposite section-level density/tension arches.
    // R49 E3: Strengthen 0.015->0.022. DT barely moved with 0.015.
    const midSectionDensityPush = m.sin(sectionProgress * m.PI) * 0.013;
    // R85 E2 + R86 E1: Density axis containment. When density axis exceeds
    // fair share (0.167), apply graduated density brake. R86: threshold
    // raised 0.18->0.20 because R85 overcorrected density to 0.1483
    // (below fair share). Higher threshold ensures brake only fires on
    // clear overshare, not near-fair-share fluctuations.
    const densityShare = densityAxisShare;
    // R1 E4: Tighten density brake. Density dominant at 0.219 (31% above
    // fair share). Lower threshold 0.20->0.18 so brake engages earlier.
    // R46 E2: Tighter range 0.08->0.06. Density ballooned to 0.233 in R45
    // (flicker brake pushed energy to density). Full brake now at 0.24
    // instead of 0.26.
    // R56 E4: Tighten density brake threshold 0.18->0.16. Density is now
    // dominant axis at 0.212 share after tension brake (R55 E4) pushed
    // energy to density. Earlier engagement reduces density overshare.
    // R57 E1: Moderate back to 0.17. At 0.16 evolving collapsed 40.2->18.6%
    // because density brake suppressed signal variance needed for regime
    // detection. Compromise preserves Gini gains while recovering evolving.
    const densityShareBrake = clamp((densityShare - 0.17) / 0.06, 0, 1) * 0.04;
    // R89 E1 / R90 E1: Density axis recovery lift. When density is below
    // fair share, apply proportional positive nudge. R89 at 0.03 overcorrected
    // density +74% (0.1325->0.2304). R90: reduced to 0.01 for gentler recovery.
    // R60 E2: Raise 0.01->0.015. R59 density share fell to 0.122, worsening
    // DT and axis balance. Slightly stronger recovery helps DT co-movement
    // without undoing the spillover brake.
    const densityDeficit = clamp((1.0 / 6.0 - densityShare) / 0.05, 0, 1);
    const densityRecoveryLift = densityDeficit * 0.015;
    // R15 E3: Coherent-regime DF density brake. Section 6 had 39/63 DF
    // exceedance beats at 75% coherent. During coherent, density and flicker
    // get neutral regime biases (both 0), so they correlate naturally. When DF
    // coupling > 0.40 in coherent, brake density to break the DF lock-step.
    const coherentDFRaw = couplingMatrix ? couplingMatrix['density-flicker'] : 0;
    const coherentDFAbs = Number.isFinite(coherentDFRaw) ? m.abs(coherentDFRaw) : 0;
    const coherentDFBrake = currentRegime === 'coherent' && coherentDFAbs > 0.40
      ? clamp((coherentDFAbs - 0.40) / 0.30, 0, 1) * 0.025
      : 0;
    // R16 E3: DT coupling density moderation. DT exceedance surged to 44
    // beats (all in S3) after DF containment. When density-tension coupling
    // > 0.50, moderate density regardless of regime to break DT correlation.
    // R48 E4: Soften max brake 0.020->0.012. At DT=-0.527 this brake rarely
    // fires (dtAbs < 0.50) but when it does, overcorrection hurts DT recovery.
    // R63 E1: Further soften this legacy brake. Recent rounds show the brake
    // is fighting the successful DT co-movement mechanisms and feeding the
    // density-tension hotspot.
    const dtRaw = couplingMatrix ? couplingMatrix['density-tension'] : 0;
    const dtAbs = Number.isFinite(dtRaw) ? m.abs(dtRaw) : 0;
    const dtDensityBrake = dtAbs > 0.55
      ? clamp((dtAbs - 0.55) / 0.30, 0, 1) * 0.006
      : 0;
    // R41 E2: Harmonic boldness DT co-movement push. When journey boldness
    // is high (bold key change), push density toward tension direction,
    // creating co-movement episodes. This fights DT anti-correlation
    // structurally -- harmonic events naturally demand both density and
    // tension to rise together. The push is proportional to boldness and
    // only fires when boldness > 0.25 to avoid noise during static passages.
    // R47 E1: Strengthen 0.015->0.025. DT at -0.644 (worst ever).
    // Budget scoring alone insufficient -- structural co-movement push
    // is the primary DT fix mechanism.
    const journeyBoldness = safePreBoot.call(
      () => journeyRhythmCoupler.getBoldness(), 0
    );
    const dtCoMovementPush = journeyBoldness > 0.25
      ? clamp((journeyBoldness - 0.25) / 0.60, 0, 1) * 0.030
      : 0;
    const tensionShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.tension === 'number'
      ? axisEnergy.shares.tension
      : 1.0 / 6.0;
    // R63 E2: DT share bridge. When DT is hot and tension share exceeds
    // density share, lift density directly to restore co-movement.
    const dtShareGap = clamp(tensionShare - densityShare, 0, 0.12) / 0.12;
    const dtShareBridgeLift = dtAbs > 0.45
      ? clamp((dtAbs - 0.45) / 0.35, 0, 1) * dtShareGap * 0.015
      : 0;
    const rawD = 1.0 + (REGIME_DENSITY_DIR[currentRegime] || 0) * MAX_DENSITY * curvatureGain + regimeReactiveDampingDriftD + regimeReactiveDampingEqCorrD - densityHotspotBrake + evolvingLift * 0.5 + densityRebalanceLift + sectionDensityNudge + midSectionDensityPush - densityShareBrake + densityRecoveryLift - coherentDFBrake - dtDensityBrake + dtCoMovementPush + dtShareBridgeLift;
    // #7 (R7): Tension pin relief valve - track pinning and relax ceiling
    const effectiveMaxTension = MAX_TENSION + regimeReactiveDampingTensionCeilingRelax;
    // R91 E3: Tension share brake. Tension axis surged to 0.2316 (dominant),
    // creating DT exceedance monopoly (38 beats). Mirrors density share brake
    // logic: activates above 0.20, full 0.04 brake at 0.28.
    // R55 E4: Tighten threshold 0.20->0.18, increase max 0.04->0.06. Tension
    // share was 0.226 in R54 (dominant), driving axisGini to 0.119. Earlier
    // brake engagement with stronger cap reduces tension dominance.
    const tensionShareBrake = clamp((tensionShare - 0.18) / 0.08, 0, 1) * 0.06;
    // R42 E4: Tension axis share floor nudge. When tension share drops below
    // 0.16 (1/6 = 0.167 fair share), apply graduated upward tension nudge.
    // Tension fell 0.199->0.148 in R41 as density/trust surged. Max +0.015
    // nudge at share=0.10. Symmetric with existing density recovery lift.
    // R60 E4: Start slightly earlier and stronger. TE regressed to -0.332
    // in R59 while tension hovered near the floor.
    const tensionRecoveryLift2 = tensionShare < 0.17
      ? clamp((0.17 - tensionShare) / 0.06, 0, 1) * 0.018
      : 0;
    // R41 E1: Harmonic boldness tension push (moved from journeyRhythmCoupler
    // because the feedbackGraphContract blocks cross-layer modules from
    // registering conductor biases). Bold key moves push tension up alongside
    // density (see E2 dtCoMovementPush), creating co-movement moments.
    // R44 E4: Strengthen push 0.012->0.018.
    // R47 E1: Strengthen push 0.018->0.025 alongside density push to
    // maintain coordinated DT co-movement at stronger magnitude.
    const boldnessTensionPush = journeyBoldness > 0.25
      ? clamp((journeyBoldness - 0.25) / 0.60, 0, 1) * 0.030
      : 0;
    // R63 E3: DT tension trim. When DT is hot and tension dominates the axis
    // share, trim tension slightly so density can reconnect without opening a
    // broad tension collapse.
    const dtTensionTrim = dtAbs > 0.45
      ? clamp((dtAbs - 0.45) / 0.35, 0, 1) * dtShareGap * 0.010
      : 0;
    const rawT = 1.0 + (REGIME_TENSION_DIR[currentRegime] || 0) * effectiveMaxTension * curvatureGain + regimeReactiveDampingDriftT + regimeReactiveDampingEqCorrT + sectionTensionNudge + tensionRecoveryNudge + evolvingLift + coherentToEvolvingReheat - exploringBiasBrake - tensionFlickerRelease - tensionShareBrake + boldnessTensionPush + tensionRecoveryLift2 - dtTensionTrim;
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
    // R45 E4: Flicker axis share brake. Flicker surged to 0.236 (dominant,
    // 41% above fair share), worsening axisGini to 0.136. Mirrors density
    // and tension share brake logic: activates above 0.20, full 0.04 brake
    // at 0.28. flickerShare already computed near line 283 for recovery relief.
    const flickerShareBrake = clamp((flickerShare - 0.18) / 0.10, 0, 1) * 0.08;
    const rawF = 1.0 + (REGIME_FLICKER_DIR[currentRegime] || 0) * MAX_FLICKER * curvatureGain + regimeReactiveDampingDriftF + regimeReactiveDampingEqCorrF - adjustedFlickerHotspotBrake + evolvingLift - exploringBiasBrake - coherentToEvolvingReheat * 0.5 - tensionFlickerRelease * 0.7 + sectionFlickerNudge - ftDecoupleBrake - flickerShareBrake;
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
