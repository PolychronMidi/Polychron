moduleLifecycle.declare({
  name: 'regimeClassifierClassification',
  subsystem: 'conductor',
  deps: ['L0', 'validator'],
  lazyDeps: ['conductorConfig', 'conductorState', 'pipelineCouplingManager'],
  provides: ['regimeClassifierClassification'],
  init: (deps) => {
  const L0 = deps.L0;
  const V = deps.validator.create('regimeClassifierClassification');
  function classify(state, config, avgVelocity, avgCurvature, effectiveDim, couplingStrength) {
    if (avgVelocity < 0.004) return 'stagnant';
    // Lab R3: oscillating at 0.15 sounded good. Swing threshold dynamically
    // between 0.15 (stressed/tense) and 0.65 (relaxed) based on system state.
    const tensionVal = /** @type {number} */ (conductorState.getField('tension'));
    const entropyEntry = L0.getLast(L0_CHANNELS.entropy, { layer: 'both' });
    const entropyVal = entropyEntry && typeof entropyEntry.smoothed === 'number' ? entropyEntry.smoothed : 0.5;
    const oscillatingDynamic = clamp(
      state.oscillatingCurvatureThreshold
        - tensionVal * 0.25       // high tension -> lower threshold -> more oscillating
        + (1 - entropyVal) * 0.15 // low entropy -> higher threshold -> less oscillating
      , 0.15, 0.65);
    if (avgCurvature > oscillatingDynamic && avgVelocity < 0.04) return 'oscillating';

    const exploringElapsedSec = beatStartTime - state.exploringStartSec;
    const coherentElapsedSec = beatStartTime - state.coherentStartSec;
    const evolvingElapsedSec = beatStartTime - state.evolvingStartSec;
    const coherentMomentumActive = beatStartTime < state.coherentMomentumEndSec;
    const coherentMomentumRemainingSec = coherentMomentumActive ? state.coherentMomentumEndSec - beatStartTime : 0;
    const postForcedRecoveryActive = beatStartTime < state.postForcedRecoveryEndSec;
    const postForcedRecoveryRemainingSec = postForcedRecoveryActive ? state.postForcedRecoveryEndSec - beatStartTime : 0;

    const coherentFloorBonus = exploringElapsedSec > config.EXPLORING_FLOOR_BONUS_SEC ? clamp((exploringElapsedSec - config.EXPLORING_FLOOR_BONUS_SEC) * 0.0006, 0, 0.05) : 0;
    const durationBonus = state.lastRegime === 'exploring' ? clamp(m.floor(exploringElapsedSec / config.EXPLORING_DUR_BONUS_UNIT_SEC) * 0.02, 0, 0.12) : 0;
    const momentumBonus = coherentMomentumActive
      ? 0.05 * (coherentMomentumRemainingSec / config.COHERENT_MOMENTUM_SEC)
      : 0;
    if (state.coherentMomentumBeats > 0) state.coherentMomentumBeats--;

    let convergenceBonus = 0;
    if (state.lastRegime === 'exploring' && exploringElapsedSec > config.EXPLORING_CONVERGENCE_SEC) {
      convergenceBonus = clamp((exploringElapsedSec - config.EXPLORING_CONVERGENCE_SEC) * 0.006, 0, 0.15);
    }

    const adaptiveAlpha = m.max(state.coherentShareAlphaMin,
      config.COHERENT_SHARE_ALPHA_INIT * m.exp(-state.coherentBeats / config.COHERENT_SHARE_ALPHA_DECAY));
    state.coherentShareEma = state.coherentShareEma * (1 - adaptiveAlpha) + (state.lastRegime === 'coherent' ? 1 : 0) * adaptiveAlpha;

    const nearEquilibrium = state.coherentShareEma > 0.10 && state.coherentShareEma < 0.40;
    const dampedNudge = config.REGIME_SCALE_NUDGE * (nearEquilibrium ? 0.5 : 1.0);
    if (state.coherentShareEma > config.REGIME_TARGET_COHERENT_HI) {
      state.coherentThresholdScale = m.min(config.REGIME_SCALE_MAX, state.coherentThresholdScale + dampedNudge);
    } else if (state.coherentShareEma < config.REGIME_TARGET_COHERENT_LO) {
      state.coherentThresholdScale = m.max(config.REGIME_SCALE_MIN, state.coherentThresholdScale - dampedNudge);
    }

    const dynamicPenaltyCap = 0.08 + clamp((state.coherentShareEma - 0.60) * 1.0, 0, 0.20);
    // Penalty starts at target share and grows only as coherent overshoots.
    // Removed ineffective hardcoded 0.003 floor.
    const dynamicPenaltyRate = clamp((state.coherentShareEma - config.REGIME_TARGET_COHERENT_HI) * 0.016, 0, 0.008);
    let coherentDurationPenalty = 0;
    if (state.lastRegime === 'coherent' && coherentElapsedSec > config.COHERENT_DUR_PENALTY_SEC) {
      coherentDurationPenalty = clamp((coherentElapsedSec - config.COHERENT_DUR_PENALTY_SEC) * dynamicPenaltyRate * 1.2, 0, dynamicPenaltyCap);
      if (coherentElapsedSec > config.COHERENT_SATURATION_SEC) {
        const dynamicSaturationScale = 0.02 + m.max(0, (state.coherentShareEma - config.REGIME_TARGET_COHERENT_HI) * 0.05);
        coherentDurationPenalty += (coherentElapsedSec - config.COHERENT_SATURATION_SEC) * dynamicSaturationScale * 1.2;
      }
    }

    const baseCoherentThreshold = (state.lastRegime === 'coherent' ? 0.25 : 0.30) * 0.85 * state.coherentThresholdScale;
    let evolvingProximityBonus = 0;
    if (state.lastRegime === 'evolving' && evolvingElapsedSec > state.evolvingMinDwellSec) {
      evolvingProximityBonus = clamp((evolvingElapsedSec - state.evolvingMinDwellSec) * 0.0024, 0, 0.07);
    } else if (state.lastRegime === 'exploring') {
      evolvingProximityBonus = clamp(state.evolvingProximityBonus + 0.001, 0, 0.07);
    }
    state.evolvingProximityBonus = evolvingProximityBonus;

    const evolvingShare = state.runBeatCount > 0
      ? ((V.optionalFinite(state.runResolvedRegimeCounts.evolving, 0)) / state.runBeatCount)
      : 0;
    const evolvingDeficit = clamp((config.REGIME_TARGET_EVOLVING_LO - evolvingShare) / config.REGIME_TARGET_EVOLVING_LO, 0, 1);
    const rawExploringShare = state.runBeatCount > 0
      ? ((V.optionalFinite(state.runRawRegimeCounts.exploring, 0)) / state.runBeatCount)
      : 0;
    const exploringSharePressure = clamp((rawExploringShare - 0.62) / 0.14, 0, 1);
    const rawEvolvingShare = state.runBeatCount > 0
      ? ((V.optionalFinite(state.runRawRegimeCounts.evolving, 0)) / state.runBeatCount)
      : 0;
    const axisEnergyC = pipelineCouplingManager.getAxisEnergyShare();
    const trustShareC = axisEnergyC && axisEnergyC.shares && typeof axisEnergyC.shares.trust === 'number'
      ? axisEnergyC.shares.trust
      : 1.0 / 6.0;
    const trustHealthDamper = clamp((trustShareC - 0.18) / 0.08, 0, 1);
    const evolvingRecoveryBoost = clamp(((0.05 - rawEvolvingShare) / 0.05) * (1 - trustHealthDamper * 0.55), 0, 1);
    const rawNonCoherentOpportunityShare = rawExploringShare + rawEvolvingShare;
    const resolvedNonCoherentShare = state.runBeatCount > 0
      ? (((V.optionalFinite(state.runResolvedRegimeCounts.exploring, 0)) + (V.optionalFinite(state.runResolvedRegimeCounts.evolving, 0))) / state.runBeatCount)
      : 0;
    const opportunityGap = m.max(0, rawNonCoherentOpportunityShare - resolvedNonCoherentShare);
    const cadenceMonopolyPressure = clamp(
      clamp((state.runCoherentShare - 0.58) / 0.18, 0, 1) * 0.48 +
      clamp(opportunityGap / 0.22, 0, 1) * 0.32 +
      clamp((0.05 - (state.runTransitionCount / m.max(state.runBeatCount, 1))) / 0.05, 0, 1) * 0.12 +
      clamp((0.08 - rawExploringShare) / 0.08, 0, 1) * 0.08 +
      exploringSharePressure * 0.12,
      0,
      1
    );
    const opportunityPressure = clamp(opportunityGap / 0.18, 0, 1);
    const postForcedRecoveryPressure = postForcedRecoveryActive
      ? postForcedRecoveryRemainingSec / config.POST_FORCED_RECOVERY_SEC
      : 0;
    if (state.postForcedRecoveryBeats > 0) state.postForcedRecoveryBeats--;

    const coherentGateTightening = cadenceMonopolyPressure * 0.080 + opportunityPressure * 0.050 + exploringSharePressure * 0.020 + evolvingDeficit * 0.015 + evolvingRecoveryBoost * 0.020 - postForcedRecoveryPressure * 0.045;
    const coherentEntryMargin = cadenceMonopolyPressure * 0.050 + opportunityPressure * 0.040 + (state.lastRegime === 'coherent' ? 0.010 : 0) - postForcedRecoveryPressure * 0.028;
    const coherentDimMax = 4.0 - cadenceMonopolyPressure * 0.55 - opportunityPressure * 0.35;
    const coherentThreshold = baseCoherentThreshold - durationBonus - coherentFloorBonus - convergenceBonus - evolvingProximityBonus - momentumBonus + coherentDurationPenalty + coherentGateTightening - postForcedRecoveryPressure * 0.035;
    const coherentExitWindowBase = 0.08 + evolvingDeficit * 0.12;
    const evolvingEntryVelMin = 0.006;
    const evolvingEntryVelMax = 0.032 + evolvingDeficit * 0.024 + cadenceMonopolyPressure * 0.020 + opportunityPressure * 0.016 + exploringSharePressure * 0.012 + evolvingRecoveryBoost * 0.010 + postForcedRecoveryPressure * 0.014;
    const evolvingEntryDimMin = 1.75 + evolvingDeficit * 0.25 - cadenceMonopolyPressure * 0.22 - opportunityPressure * 0.12 - exploringSharePressure * 0.12 - evolvingRecoveryBoost * 0.10 - postForcedRecoveryPressure * 0.16;
    const velThreshold = exploringElapsedSec > config.EVOLVING_VELOCITY_THRESHOLD_SEC ? 0.005 : 0.008;

    state.lastClassifyInputs = {
      couplingStrength,
      coherentThreshold,
      evolvingProximityBonus,
      velocity: avgVelocity,
      velThreshold,
      effectiveDim,
      cadenceMonopolyPressure,
      rawExploringShare,
      rawEvolvingShare,
      rawNonCoherentOpportunityShare,
      resolvedNonCoherentShare,
      opportunityGap
    };

    // Adaptive highDimVelStreak: threshold follows observed dim distribution.
    // EMA alphas are regime-aware; disabled when exploring already dominates.
    const dimAlpha = state.lastRegime === 'exploring' ? 0.05 : state.lastRegime === 'coherent' ? 0.02 : 0.03;
    const velAlpha = state.lastRegime === 'exploring' ? 0.06 : state.lastRegime === 'coherent' ? 0.02 : 0.04;
    state.dimEma = state.dimEma * (1 - dimAlpha) + effectiveDim * dimAlpha;
    state.dimStdEma = state.dimStdEma * (1 - dimAlpha) + m.abs(effectiveDim - state.dimEma) * dimAlpha;
    // Track velocity distribution so evolving ceilings follow actual velocity.
    state.velocityEma = state.velocityEma * (1 - velAlpha) + avgVelocity * velAlpha;
    state.velocityStdEma = state.velocityStdEma * (1 - velAlpha) + m.abs(avgVelocity - state.velocityEma) * velAlpha;
    const highDimStreakEnabled = rawExploringShare < 0.40;
    const highDimThreshold = state.dimEma + state.dimStdEma * 1.5 + exploringSharePressure * 0.3;
    // Base streak 18 gives evolving paths more opportunity before exploring wins.
    const highDimStreakLimit = 18 + m.round(exploringSharePressure * 8);
    if (highDimStreakEnabled && effectiveDim > highDimThreshold && avgVelocity > 0.012) state.highDimVelStreak++;
    else state.highDimVelStreak = m.max(0, state.highDimVelStreak - 1);

    if (state.highDimVelStreak >= highDimStreakLimit && state.lastRegime !== 'coherent') return 'exploring';

    // Mid-composition sections get a small evolving-entry velocity boost.
    const sectionIndexForRegime = sectionIndex;
    const midSectionBoost = (sectionIndexForRegime >= 1 && sectionIndexForRegime <= 3) ? 0.015 : 0;
    // High tension widens evolving sustain to resist premature coherent entry.
    // Inner fn guarantees finite; `|| 0.5` was a redundant fallback that also
    // silently rewrote legitimate 0 tension readings to 0.5.
    const tensionBiasProduct = V.optionalFinite(conductorState.getField('tension'), 0.5);
    const tensionEvolvingSustain = clamp((tensionBiasProduct - 0.55) / 0.35, 0, 1) * 0.015;
    if (cadenceMonopolyPressure > 0.40 &&
        avgVelocity > evolvingEntryVelMin &&
        avgVelocity < evolvingEntryVelMax + 0.012 + midSectionBoost + tensionEvolvingSustain &&
        effectiveDim > evolvingEntryDimMin - 0.10 &&
        couplingStrength > coherentThreshold - 0.02 &&
        couplingStrength < coherentThreshold + 0.10) {
      return 'evolving';
    }

    // Adaptive coherent entry relaxes when coupling repeatedly stalls near threshold.
    const coherentGapToEntry = couplingStrength - (coherentThreshold + coherentEntryMargin);
    if (coherentGapToEntry > -0.06 && coherentGapToEntry < 0 && avgVelocity > velThreshold && effectiveDim <= coherentDimMax) {
      state.coherentBlockStreak++;
    } else if (state.lastRegime === 'coherent' || coherentGapToEntry >= 0) {
      // Decay prevents rapid re-accumulation after a brief coherent pass.
      state.coherentBlockStreak = m.max(0, state.coherentBlockStreak - 2);
    }
    const coherentBlockRelax = clamp(state.coherentBlockStreak * 0.004, 0, 0.04);
    // Minimum dead band prevents blockRelax from causing entry/exit oscillation.
    const coherentExitWindow = m.max(coherentExitWindowBase, coherentEntryMargin + coherentBlockRelax + 0.02);

    if (couplingStrength > coherentThreshold + coherentEntryMargin - coherentBlockRelax && avgVelocity > velThreshold && effectiveDim <= coherentDimMax) return 'coherent';

    const recentlyCoherent = state.lastRegime === 'coherent' || coherentMomentumActive;
    const coherentGap = couplingStrength - coherentThreshold;
    if (recentlyCoherent &&
        coherentGap > -coherentExitWindow &&
        avgVelocity > evolvingEntryVelMin &&
        avgVelocity < evolvingEntryVelMax + evolvingRecoveryBoost * 0.008 &&
        effectiveDim > evolvingEntryDimMin - evolvingRecoveryBoost * 0.08 &&
        couplingStrength > 0.09 - evolvingRecoveryBoost * 0.015) {
      return 'evolving';
    }

    // Shared adaptive velocity ceiling uses EMA directly for crossover/self-sustain.
    const adaptiveVelCeiling = m.max(0.090, state.velocityEma);

    // Starved evolving widens self-sustain on both floor and ceiling.
    if (state.lastRegime === 'evolving' &&
        avgVelocity > evolvingEntryVelMin &&
        avgVelocity < adaptiveVelCeiling + 0.010 + evolvingRecoveryBoost * 0.006 &&
        effectiveDim > 1.65 - evolvingDeficit * 0.15 &&
        couplingStrength > 0.08 - evolvingDeficit * 0.02 &&
        couplingStrength < coherentThreshold + 0.16 + evolvingDeficit * 0.08) {
      return 'evolving';
    }

    // Evaluate exploring->evolving crossover before generic exploring capture.
    // Recovery boost tapers off as raw evolving share normalizes.
    const evolvingCriticalBoost = rawEvolvingShare < 0.04
      ? 0.020 * clamp((0.04 - rawEvolvingShare) / 0.02, 0, 1)
      : 0;
    // Adaptive dwell shortens when evolving is starved.
    const crossoverMinDwellSec = m.max(0.83, config.CROSSOVER_MIN_DWELL_SEC - evolvingDeficit * 1.66);
    if (state.lastRegime === 'exploring' && exploringElapsedSec >= crossoverMinDwellSec && avgVelocity > 0.007 && avgVelocity < adaptiveVelCeiling + opportunityPressure * 0.012 + exploringSharePressure * 0.010 + evolvingRecoveryBoost * 0.035 + evolvingCriticalBoost && effectiveDim > 1.4 - exploringSharePressure * 0.10 - evolvingRecoveryBoost * 0.25 && couplingStrength > 0.07 + evolvingDeficit * 0.012 - opportunityPressure * 0.012 - exploringSharePressure * 0.014 - evolvingRecoveryBoost * 0.025) return 'evolving';

    const exploringVelThreshold = (evolvingElapsedSec > config.EVOLVING_VELOCITY_THRESHOLD_SEC ? 0.010 : 0.012) + exploringSharePressure * 0.004 - cadenceMonopolyPressure * 0.003 - opportunityPressure * 0.001 + postForcedRecoveryPressure * 0.003;
    const profileDimRelief = conductorConfig.getActiveProfile().exploringDimRelief ?? 0;
    const exploringDimThreshold = (couplingStrength < 0.50 ? 2.2 : 2.5) - profileDimRelief - cadenceMonopolyPressure * 0.28 - opportunityPressure * 0.10 + exploringSharePressure * 0.12 + postForcedRecoveryPressure * 0.06;
    const exploringCouplingGate = 0.50 + cadenceMonopolyPressure * 0.08 + opportunityPressure * 0.06 - exploringSharePressure * 0.06 - postForcedRecoveryPressure * 0.05;
    if (avgVelocity > exploringVelThreshold && effectiveDim > exploringDimThreshold && couplingStrength <= exploringCouplingGate) return 'exploring';

    if (couplingStrength < 0.15 && effectiveDim > 2.5) return 'fragmented';
    if (avgCurvature < 0.2 && avgVelocity > 0.008) return 'drifting';
    return 'evolving';
  }

  return { classify };
  },
});
