regimeClassifierClassification = (() => {
  function classify(state, config, avgVelocity, avgCurvature, effectiveDim, couplingStrength) {
    if (avgVelocity < 0.004) return 'stagnant';
    if (avgCurvature > state.oscillatingCurvatureThreshold && avgVelocity < 0.04) return 'oscillating';

    const coherentFloorBonus = state.exploringBeats > 100 ? clamp((state.exploringBeats - 100) * 0.0005, 0, 0.05) : 0;
    const durationBonus = state.lastRegime === 'exploring' ? clamp(m.floor(state.exploringBeats / 50) * 0.02, 0, 0.12) : 0;
    const momentumBonus = state.coherentMomentumBeats > 0
      ? 0.05 * (state.coherentMomentumBeats / config.COHERENT_MOMENTUM_WINDOW)
      : 0;
    if (state.coherentMomentumBeats > 0) state.coherentMomentumBeats--;

    let convergenceBonus = 0;
    if (state.lastRegime === 'exploring' && state.exploringBeats > 32) {
      convergenceBonus = clamp((state.exploringBeats - 32) * 0.005, 0, 0.15);
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
    if (state.lastRegime === 'coherent' && state.coherentBeats > 35) {
      coherentDurationPenalty = clamp((state.coherentBeats - 35) * dynamicPenaltyRate, 0, dynamicPenaltyCap);
      if (state.coherentBeats > 100) {
        const dynamicSaturationScale = 0.02 + m.max(0, (state.coherentShareEma - config.REGIME_TARGET_COHERENT_HI) * 0.05);
        coherentDurationPenalty += (state.coherentBeats - 100) * dynamicSaturationScale;
      }
    }

    const baseCoherentThreshold = (state.lastRegime === 'coherent' ? 0.25 : 0.30) * 0.85 * state.coherentThresholdScale;
    let evolvingProximityBonus = 0;
    if (state.lastRegime === 'evolving' && state.evolvingBeats > state.evolvingMinDwell) {
      evolvingProximityBonus = clamp((state.evolvingBeats - state.evolvingMinDwell) * 0.002, 0, 0.07);
    } else if (state.lastRegime === 'exploring') {
      evolvingProximityBonus = clamp(state.evolvingProximityBonus + 0.001, 0, 0.07);
    }
    state.evolvingProximityBonus = evolvingProximityBonus;

    const evolvingShare = state.runBeatCount > 0
      ? ((state.runResolvedRegimeCounts.evolving || 0) / state.runBeatCount)
      : 0;
    const evolvingDeficit = clamp((config.REGIME_TARGET_EVOLVING_LO - evolvingShare) / config.REGIME_TARGET_EVOLVING_LO, 0, 1);
    const rawExploringShare = state.runBeatCount > 0
      ? ((state.runRawRegimeCounts.exploring || 0) / state.runBeatCount)
      : 0;
    const exploringSharePressure = clamp((rawExploringShare - 0.62) / 0.14, 0, 1);
    const rawEvolvingShare = state.runBeatCount > 0
      ? ((state.runRawRegimeCounts.evolving || 0) / state.runBeatCount)
      : 0;
    const axisEnergyC = safePreBoot.call(() => pipelineCouplingManager.getAxisEnergyShare(), null);
    const trustShareC = axisEnergyC && axisEnergyC.shares && typeof axisEnergyC.shares.trust === 'number'
      ? axisEnergyC.shares.trust
      : 1.0 / 6.0;
    const trustHealthDamper = clamp((trustShareC - 0.18) / 0.08, 0, 1);
    const evolvingRecoveryBoost = clamp(((0.05 - rawEvolvingShare) / 0.05) * (1 - trustHealthDamper * 0.55), 0, 1);
    const rawNonCoherentOpportunityShare = rawExploringShare + rawEvolvingShare;
    const resolvedNonCoherentShare = state.runBeatCount > 0
      ? (((state.runResolvedRegimeCounts.exploring || 0) + (state.runResolvedRegimeCounts.evolving || 0)) / state.runBeatCount)
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
    const postForcedRecoveryPressure = state.postForcedRecoveryBeats > 0
      ? state.postForcedRecoveryBeats / config.POST_FORCED_RECOVERY_WINDOW
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
    const velThreshold = state.exploringBeats > 100 ? 0.005 : 0.008;

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

    if (effectiveDim > 2.8 && avgVelocity > 0.012) state.highDimVelStreak++;
    else state.highDimVelStreak = 0;

    if (state.highDimVelStreak >= 10 && state.lastRegime !== 'coherent') return 'exploring';

    if (cadenceMonopolyPressure > 0.40 &&
        avgVelocity > evolvingEntryVelMin &&
        avgVelocity < evolvingEntryVelMax + 0.012 &&
        effectiveDim > evolvingEntryDimMin - 0.10 &&
        couplingStrength > coherentThreshold - 0.02 &&
        couplingStrength < coherentThreshold + 0.10) {
      return 'evolving';
    }

    if (couplingStrength > coherentThreshold + coherentEntryMargin && avgVelocity > velThreshold && effectiveDim <= coherentDimMax) return 'coherent';

    const recentlyCoherent = state.lastRegime === 'coherent' || state.coherentMomentumBeats > 0;
    const coherentGap = couplingStrength - coherentThreshold;
    if (recentlyCoherent &&
        coherentGap > -coherentExitWindow &&
        avgVelocity > evolvingEntryVelMin &&
        avgVelocity < evolvingEntryVelMax + evolvingRecoveryBoost * 0.008 &&
        effectiveDim > evolvingEntryDimMin - evolvingRecoveryBoost * 0.08 &&
        couplingStrength > 0.09 - evolvingRecoveryBoost * 0.015) {
      return 'evolving';
    }

    if (state.lastRegime === 'evolving' &&
        avgVelocity > evolvingEntryVelMin &&
        avgVelocity < evolvingEntryVelMax + 0.010 + evolvingRecoveryBoost * 0.006 &&
        effectiveDim > 1.65 &&
        couplingStrength > 0.08 &&
        couplingStrength < coherentThreshold + 0.16 + evolvingDeficit * 0.08) {
      return 'evolving';
    }

    const exploringVelThreshold = (state.evolvingBeats > 100 ? 0.010 : 0.012) + exploringSharePressure * 0.004 - cadenceMonopolyPressure * 0.003 - opportunityPressure * 0.001 + postForcedRecoveryPressure * 0.003;
    const profileDimRelief = conductorConfig.getActiveProfile().exploringDimRelief || 0;
    const exploringDimThreshold = (couplingStrength < 0.50 ? 2.2 : 2.5) - profileDimRelief - cadenceMonopolyPressure * 0.28 - opportunityPressure * 0.10 + exploringSharePressure * 0.12 + postForcedRecoveryPressure * 0.06;
    const exploringCouplingGate = 0.50 + cadenceMonopolyPressure * 0.08 + opportunityPressure * 0.06 - exploringSharePressure * 0.06 - postForcedRecoveryPressure * 0.05;
    if (avgVelocity > exploringVelThreshold && effectiveDim > exploringDimThreshold && couplingStrength <= exploringCouplingGate) return 'exploring';
    if (state.lastRegime === 'exploring' && avgVelocity > 0.007 && avgVelocity < 0.060 + opportunityPressure * 0.010 + exploringSharePressure * 0.008 + evolvingRecoveryBoost * 0.008 && effectiveDim > 1.6 - exploringSharePressure * 0.08 - evolvingRecoveryBoost * 0.06 && couplingStrength > 0.08 + evolvingDeficit * 0.015 - opportunityPressure * 0.010 - exploringSharePressure * 0.012 - evolvingRecoveryBoost * 0.012) return 'evolving';
    if (couplingStrength < 0.15 && effectiveDim > 2.5) return 'fragmented';
    if (avgCurvature < 0.2 && avgVelocity > 0.008) return 'drifting';
    return 'evolving';
  }

  return { classify };
})();
