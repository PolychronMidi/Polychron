regimeClassifierClassification = (() => {
  const V = validator.create('regimeClassifierClassification');
  function classify(state, config, avgVelocity, avgCurvature, effectiveDim, couplingStrength) {
    if (avgVelocity < 0.004) return 'stagnant';
    if (avgCurvature > state.oscillatingCurvatureThreshold && avgVelocity < 0.04) return 'oscillating';

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
    const dynamicPenaltyRate = 0.003 + clamp((state.coherentShareEma - 0.50) * 0.004, 0, 0.004);
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
    const axisEnergyC = safePreBoot.call(() => pipelineCouplingManager.getAxisEnergyShare(), null);
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
    const coherentExitWindow = 0.08 + evolvingDeficit * 0.12;
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

    // R65 E1: Distribution-adaptive highDimVelStreak. Track running EMA of
    // effectiveDim and its standard deviation. Set threshold relative to the
    // observed distribution instead of static 2.8. Gate the streak entirely
    // when exploring already dominates (rawExploringShare > 0.40).
    state.dimEma = state.dimEma * 0.97 + effectiveDim * 0.03;
    state.dimStdEma = state.dimStdEma * 0.97 + m.abs(effectiveDim - state.dimEma) * 0.03;
    // R79 E1: Track velocity distribution for adaptive evolving ceiling.
    // Instead of hardcoded 0.090 ceiling (whack-a-mole since R68), derive
    // from the actual velocity EMA + stddev. The enriched phase signal (R67)
    // raised velocity to 0.11-0.21, making fixed ceilings obsolete.
    state.velocityEma = state.velocityEma * 0.96 + avgVelocity * 0.04;
    state.velocityStdEma = state.velocityStdEma * 0.96 + m.abs(avgVelocity - state.velocityEma) * 0.04;
    const highDimStreakEnabled = rawExploringShare < 0.40;
    const highDimThreshold = state.dimEma + state.dimStdEma * 1.5 + exploringSharePressure * 0.3;
    // R72 E2: Raise base from 14 to 18. With evolving at 11.9% (R71),
    // the exploring velocity shortcut fires too aggressively, capturing
    // beats that should go through evolving classification paths.
    // At 18, evolving paths get 4 more beats of opportunity per streak.
    const highDimStreakLimit = 18 + m.round(exploringSharePressure * 8);
    if (highDimStreakEnabled && effectiveDim > highDimThreshold && avgVelocity > 0.012) state.highDimVelStreak++;
    else state.highDimVelStreak = m.max(0, state.highDimVelStreak - 1);

    if (state.highDimVelStreak >= highDimStreakLimit && state.lastRegime !== 'coherent') return 'exploring';

    // R79 E4: Section-position-aware evolving entry. Mid-composition
    // sections (S1-S3) get a velocity ceiling boost for the cadence monopoly
    // path, making evolving transitions more likely during the musically
    // interesting core. S0/S4 keep original thresholds since evolving
    // during warmup or resolution is less valuable.
    const sectionIndexForRegime = sectionIndex;
    const midSectionBoost = (sectionIndexForRegime >= 1 && sectionIndexForRegime <= 3) ? 0.015 : 0;
    // R2 E3: Tension-aware evolving sustain. When tension bias product
    // is elevated (from R1 E2 tension dir 1.3), curvature rises and
    // accelerates coherent entry. Counter this by widening the evolving
    // velocity ceiling when tension is high, so evolving can persist
    // despite stronger tension-driven curvature. Uses the actual tension
    // signal rather than a hardcoded constant.
    const tensionBiasProduct = safePreBoot.call(() => {
      const s = conductorState.getField('tension');
      return typeof s === 'number' && Number.isFinite(s) ? s : 0.5;
    }, 0.5) || 0.5;
    const tensionEvolvingSustain = clamp((tensionBiasProduct - 0.55) / 0.35, 0, 1) * 0.015;
    if (cadenceMonopolyPressure > 0.40 &&
        avgVelocity > evolvingEntryVelMin &&
        avgVelocity < evolvingEntryVelMax + 0.012 + midSectionBoost + tensionEvolvingSustain &&
        effectiveDim > evolvingEntryDimMin - 0.10 &&
        couplingStrength > coherentThreshold - 0.02 &&
        couplingStrength < coherentThreshold + 0.10) {
      return 'evolving';
    }

    // R65 E3: Adaptive coherent entry relaxation. When coherent is repeatedly
    // blocked (coupling just below threshold), progressively relax the entry
    // margin so coherent can eventually break through the coupling barrier.
    const coherentGapToEntry = couplingStrength - (coherentThreshold + coherentEntryMargin);
    if (coherentGapToEntry > -0.06 && coherentGapToEntry < 0 && avgVelocity > velThreshold && effectiveDim <= coherentDimMax) {
      state.coherentBlockStreak++;
    } else if (state.lastRegime === 'coherent' || coherentGapToEntry >= 0) {
      state.coherentBlockStreak = 0;
    }
    const coherentBlockRelax = clamp(state.coherentBlockStreak * 0.004, 0, 0.04);

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

    // R81 E1: Moved adaptiveVelCeiling before self-sustain so both paths
    // (self-sustain and crossover) can use the same adaptive ceiling.
    const adaptiveVelCeiling = m.max(0.090, state.velocityEma - state.velocityStdEma * 0.5);

    // R99 E3: Widen evolving self-sustain coupling band when evolving is starved.
    // evolvingDeficit already widens the upper bound; now also lower the coupling
    // floor and raise the dim tolerance proportional to deficit. This makes the
    // self-sustain window genuinely wider (not just upper-shifted) when evolving
    // share falls below 14%.
    if (state.lastRegime === 'evolving' &&
        avgVelocity > evolvingEntryVelMin &&
        avgVelocity < adaptiveVelCeiling + 0.010 + evolvingRecoveryBoost * 0.006 &&
        effectiveDim > 1.65 - evolvingDeficit * 0.15 &&
        couplingStrength > 0.08 - evolvingDeficit * 0.02 &&
        couplingStrength < coherentThreshold + 0.16 + evolvingDeficit * 0.08) {
      return 'evolving';
    }

    // R80 E2: Promoted exploring->evolving crossover BEFORE the generic
    // exploring check. Previously, the exploring check (high dim + low
    // coupling) caught ALL non-coherent beats because effectiveDim p10=2.97
    // always exceeded the exploring threshold (~2.2). The crossover at line
    // ~207 was dead code -- rawEvolvingShare stayed at 0 across all runs.
    //
    // By evaluating the crossover first, beats coming FROM exploring that
    // have moderate coupling and velocity get classified as evolving before
    // the exploring catch-all fires. This is self-limiting: requires
    // lastRegime=exploring, and evolvingRecoveryBoost naturally disengages
    // as rawEvolvingShare approaches 0.05.
    //
    // R65 E5 / R68 E1 / R79 E1: Adaptive velocity ceiling history preserved.
    // R81 E1: adaptiveVelCeiling moved earlier (before self-sustain block).
    // R84 E3: Raise critical boost threshold 0.02->0.04. rawEvolvingShare
    // dropped to 0.06 in R83 (from 0.0886). At threshold 0.02, the boost
    // only fires in extreme starvation. At 0.04, the boost activates
    // whenever evolving falls below 4%, providing a wider recovery window.
    // Also graduated: full 0.020 boost below 0.02, linear taper to 0 at 0.04.
    const evolvingCriticalBoost = rawEvolvingShare < 0.04
      ? 0.020 * clamp((0.04 - rawEvolvingShare) / 0.02, 0, 1)
      : 0;
    // R82 E2 / R89 E2: Minimum exploring dwell before crossover.
    // R74 E6: Adaptive dwell - instead of fixed 3, scale with evolvingDeficit.
    // When evolving is healthy (deficit ~0), dwell stays at 3. When severely
    // starved (deficit=1, evolving < 14%), dwell drops to 1. This is a
    // structural self-correcting mechanism: as evolving recovers, the dwell
    // automatically tightens back to prevent exploring collapse.
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
})();
