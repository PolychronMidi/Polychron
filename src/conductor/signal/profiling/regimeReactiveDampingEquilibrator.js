regimeReactiveDampingEquilibrator = (() => {
  function compute(args) {
    args.regimeRing.push(args.currentRegime);
    if (args.regimeRing.length > args.regimeRingSize) args.regimeRing.shift();
    if (args.regimeRing.length < 16) {
      args.eqCorrD = 0;
      args.eqCorrT = 0;
      args.eqCorrF = 0;
      explainabilityBus.emit('REGIME_REACTIVE_DAMPING_EQUILIBRATOR_WARMUP', 'both', {
        samples: args.regimeRing.length,
        required: 16,
      });
      return;
    }

    const shares = {};
    for (let i = 0; i < args.regimeRing.length; i++) {
      shares[args.regimeRing[i]] = (shares[args.regimeRing[i]] || 0) + 1;
    }
    for (const key in shares) shares[key] /= args.regimeRing.length;

    const expShare = shares.exploring || 0;
    const cohShare = shares.coherent || 0;
    const expExcess = m.max(0, expShare - args.regimeBudget.exploring);
    const cohDeficit = m.max(0, args.regimeBudget.coherent - cohShare);
    const evoDeficit = m.max(0, args.regimeBudget.evolving - (shares.evolving || 0));
    const cohExcess = m.max(0, cohShare - args.regimeBudget.coherent);

    let runCoherentShare = cohShare;
    let coherentLockPressure = 0;
    let forcedBreakPressure = 0;
    let transitionScarcity = 0;
    let cadenceMonopolyPressure = 0;
    let rawNonCoherentOpportunityShare = 0;
    let opportunityGap = 0;
    let postForcedRecoveryPressure = 0;
    const readiness = safePreBoot.call(() => regimeClassifier.getTransitionReadiness(), null);
    if (readiness) {
      if (typeof readiness.runCoherentShare === 'number') runCoherentShare = readiness.runCoherentShare;
      if (typeof readiness.runCoherentBeats === 'number') coherentLockPressure = clamp((readiness.runCoherentBeats - 48) / 96, 0, 1);
      if (typeof readiness.runTransitionCount === 'number' && typeof readiness.runBeatCount === 'number' && readiness.runBeatCount > 64) {
        const transitionRate = readiness.runTransitionCount / readiness.runBeatCount;
        transitionScarcity = clamp((0.035 - transitionRate) / 0.035, 0, 1);
      }
      if (typeof readiness.runBeatCount === 'number' && readiness.runBeatCount > 96) {
        const noForcedBreaks = typeof readiness.forcedBreakCount === 'number' && readiness.forcedBreakCount === 0;
        if (noForcedBreaks && runCoherentShare > 0.55) {
          forcedBreakPressure = clamp((readiness.runBeatCount - 96) / 192, 0, 0.35);
        }
      }
      if (typeof readiness.cadenceMonopolyPressure === 'number') cadenceMonopolyPressure = clamp(readiness.cadenceMonopolyPressure, 0, 1);
      if (typeof readiness.rawNonCoherentOpportunityShare === 'number') rawNonCoherentOpportunityShare = clamp(readiness.rawNonCoherentOpportunityShare, 0, 1);
      if (typeof readiness.opportunityGap === 'number') opportunityGap = clamp(readiness.opportunityGap, 0, 1);
      if (typeof readiness.postForcedRecoveryBeats === 'number') postForcedRecoveryPressure = clamp(readiness.postForcedRecoveryBeats / 24, 0, 1);
    }

    let phaseHotspotPressure = 0;
    let trustHotspotPressure = 0;
    let densityFlickerPressure = 0;
    if (args.snap && args.snap.couplingMatrix) {
      const matrix = args.snap.couplingMatrix;
      const phasePairs = ['density-phase', 'flicker-phase', 'tension-phase'];
      const trustPairs = ['density-trust', 'flicker-trust', 'tension-trust'];
      let phaseMax = 0;
      let trustMax = 0;
      for (let i = 0; i < phasePairs.length; i++) phaseMax = m.max(phaseMax, m.abs(matrix[phasePairs[i]] || 0));
      for (let i = 0; i < trustPairs.length; i++) trustMax = m.max(trustMax, m.abs(matrix[trustPairs[i]] || 0));
      phaseHotspotPressure = clamp((phaseMax - 0.78) / 0.20, 0, 1);
      trustHotspotPressure = clamp((trustMax - 0.74) / 0.20, 0, 1);
      densityFlickerPressure = clamp((m.abs(matrix['density-flicker'] || 0) - 0.82) / 0.16, 0, 1);
    }
    const homeostasis = safePreBoot.call(() => couplingHomeostasis.getState(), null);
    const stickyTailPressure = homeostasis && typeof homeostasis.stickyTailPressure === 'number'
      ? clamp(homeostasis.stickyTailPressure / 0.55, 0, 1)
      : 0;
    const hotspotCounterpressure = clamp(
      phaseHotspotPressure * 0.40 +
      trustHotspotPressure * 0.32 +
      densityFlickerPressure * 0.10 +
      stickyTailPressure * 0.58,
      0,
      1.20
    );
    const flickerPenalty = clamp(
      phaseHotspotPressure * 0.60 +
      trustHotspotPressure * 0.35 +
      stickyTailPressure * 0.40 +
      clamp((args.smoothedFlicker - 1.10) / 0.08, 0, 0.40),
      0,
      0.95
    );

    const expPenalty = expShare > 0.60 ? 1.0 + (expShare - 0.60) * (expShare - 0.60) : 1.0;
    const runCoherentOvershare = m.max(0, runCoherentShare - args.regimeBudget.coherent);
    const coherentPressure = clamp(
      cohExcess * 0.9 +
      runCoherentOvershare * 2.4 +
      m.max(0, args.regimeBudget.exploring - expShare) * 0.75 +
      coherentLockPressure * 0.85 +
      transitionScarcity * 0.55 +
      cadenceMonopolyPressure * 0.95 +
      opportunityGap * 0.65 +
      forcedBreakPressure,
      0,
      1.25
    );
    const evolvingPressure = clamp(
      evoDeficit * 2.10 +
      m.max(0, expShare - args.regimeBudget.exploring) * 0.50 +
      m.max(0, runCoherentShare - 0.28) * 0.35 -
      coherentPressure * 0.15 +
      cadenceMonopolyPressure * 0.18 +
      opportunityGap * 0.25 +
      postForcedRecoveryPressure * 0.42,
      0,
      1
    );

    args.eqCorrD = -expExcess * args.equilibStrength * (0.5 + postForcedRecoveryPressure * 0.55) * expPenalty;
    args.eqCorrF = -expExcess * args.equilibStrength * (1 + postForcedRecoveryPressure * 0.70) * expPenalty;
    args.eqCorrT = (cohDeficit + evoDeficit * 0.5) * args.equilibStrength + postForcedRecoveryPressure * 0.08 + expExcess * postForcedRecoveryPressure * 0.05;

    if (expShare > 0.55) {
      const monopolyPressure = clamp((expShare - 0.55) / 0.15, 0, 1);
      const squaredEscalation = 1.0 + monopolyPressure * monopolyPressure * 1.20;
      const budgetDampen = homeostasis && typeof homeostasis.budgetConstraintPressure === 'number'
        ? 1.0 - homeostasis.budgetConstraintPressure * 0.35
        : 1.0;
      args.eqCorrT += monopolyPressure * args.equilibStrength * 1.50 * squaredEscalation * budgetDampen;
      args.eqCorrD -= monopolyPressure * args.equilibStrength * 0.60 * squaredEscalation * budgetDampen;
      args.eqCorrF -= monopolyPressure * args.equilibStrength * 0.85 * squaredEscalation * budgetDampen;
    }

    if (coherentPressure > 0) {
      args.eqCorrD += coherentPressure * (args.equilibStrength * 0.75 + hotspotCounterpressure * 0.11);
      if (transitionScarcity > 0.25 && runCoherentShare > args.regimeBudget.coherent) args.eqCorrD += coherentPressure * 0.04;
      args.eqCorrF += coherentPressure * m.max(0, args.equilibStrength * (1.45 + hotspotCounterpressure * 0.55 - flickerPenalty * 0.70));
      args.eqCorrT -= coherentPressure * (args.equilibStrength * 1.15 + hotspotCounterpressure * 0.14);
    }
    if (cadenceMonopolyPressure > 0) {
      const monopolyCounterpressure = cadenceMonopolyPressure * (
        0.20 +
        hotspotCounterpressure * 0.08 +
        clamp(rawNonCoherentOpportunityShare / 0.25, 0, 1) * 0.05
      );
      args.eqCorrD += monopolyCounterpressure;
      args.eqCorrF += monopolyCounterpressure * m.max(0.90, 1.20 - flickerPenalty * 0.35);
      args.eqCorrT -= monopolyCounterpressure * 1.15;
      if (args.currentRegime === 'coherent') {
        args.eqCorrD += cadenceMonopolyPressure * 0.05;
        args.eqCorrF += cadenceMonopolyPressure * 0.07;
      }
    }
    if (args.currentRegime !== 'coherent' && evolvingPressure > 0) {
      args.eqCorrT += evolvingPressure * (args.equilibStrength * 0.80 + 0.04);
      args.eqCorrD += evolvingPressure * (args.equilibStrength * 0.24);
      args.eqCorrF -= evolvingPressure * (args.equilibStrength * 0.34);
      if (args.currentRegime === 'exploring') {
        args.eqCorrT += evolvingPressure * 0.03;
        args.eqCorrF -= evolvingPressure * 0.05;
      }
    }
    if (args.currentRegime === 'exploring' && postForcedRecoveryPressure > 0) {
      args.eqCorrD -= postForcedRecoveryPressure * 0.07;
      args.eqCorrF -= postForcedRecoveryPressure * 0.12;
      args.eqCorrT += postForcedRecoveryPressure * 0.09;
    }

    safePreBoot.call(() => {
      if (args.eqCorrD !== 0) conductorMetaWatchdog.recordCorrection('density', 'equilibrator', args.eqCorrD);
      if (args.eqCorrT !== 0) conductorMetaWatchdog.recordCorrection('tension', 'equilibrator', args.eqCorrT);
      if (args.eqCorrF !== 0) conductorMetaWatchdog.recordCorrection('flicker', 'equilibrator', args.eqCorrF);
    });
  }

  return {
    compute,
  };
})();
