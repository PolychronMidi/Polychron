adaptiveTrustScoresHelpers = (() => {
  let adaptiveTrustScoresHelpersHotspotCacheBeatKey = '';
  const adaptiveTrustScoresHelpersHotspotCache = new Map();

  function adaptiveTrustScoresHelpersGetBeatKey() {
    const safeSection = Number.isFinite(sectionIndex) ? sectionIndex : -1;
    const safePhrase = Number.isFinite(phraseIndex) ? phraseIndex : -1;
    const safeBeat = Number.isFinite(beatStart) ? beatStart : (Number.isFinite(beatCount) ? beatCount : -1);
    return safeSection + ':' + safePhrase + ':' + safeBeat;
  }

  const genericDominanceCapProfile = { scoreFloor: 0.60, scorePenalty: 0.08, weightFloor: 1.28, weightPenalty: 0.12 };
  const dominanceCapProfile = {
    [trustSystems.names.COHERENCE_MONITOR]: { scoreFloor: 0.48, scorePenalty: 0.22, weightFloor: 1.16, weightPenalty: 0.44 },
    [trustSystems.names.PHASE_LOCK]: { scoreFloor: 0.48, scorePenalty: 0.12, weightFloor: 1.20, weightPenalty: 0.26 },
    [trustSystems.names.ENTROPY_REGULATOR]: { scoreFloor: 0.48, scorePenalty: 0.12, weightFloor: 1.20, weightPenalty: 0.26 },
  };
  const pairAwareHotspotPairs = {
    [trustSystems.names.COHERENCE_MONITOR]: ['density-trust', 'flicker-trust', 'tension-trust'],
    [trustSystems.names.PHASE_LOCK]: ['density-phase', 'flicker-phase', 'tension-phase', 'trust-phase'],
    [trustSystems.names.CADENCE_ALIGNMENT]: ['density-trust', 'tension-trust', 'density-phase'],
    [trustSystems.names.STUTTER_CONTAGION]: ['flicker-trust', 'density-flicker', 'flicker-phase'],
    [trustSystems.names.FEEDBACK_OSCILLATOR]: ['tension-flicker', 'flicker-trust', 'flicker-phase'],
    [trustSystems.names.ENTROPY_REGULATOR]: ['density-entropy', 'tension-entropy', 'flicker-entropy', 'entropy-trust', 'entropy-phase'],
    [trustSystems.names.CONVERGENCE]: ['density-trust', 'tension-trust', 'density-phase', 'tension-phase'],
    [trustSystems.names.REST_SYNCHRONIZER]: ['density-trust', 'flicker-trust'],
  };
  const pairAwarePairWeights = {
    [trustSystems.names.COHERENCE_MONITOR]: { 'density-trust': 1.26, 'flicker-trust': 1.22, 'tension-trust': 1.08 },
    [trustSystems.names.PHASE_LOCK]: { 'flicker-phase': 1.20, 'density-phase': 1.10, 'tension-phase': 1.05, 'trust-phase': 1.05 },
    [trustSystems.names.CADENCE_ALIGNMENT]: { 'tension-trust': 1.25, 'density-trust': 1.16, 'density-phase': 1.08 },
    [trustSystems.names.STUTTER_CONTAGION]: { 'density-flicker': 1.25, 'flicker-phase': 1.10, 'flicker-trust': 1.16 },
    [trustSystems.names.FEEDBACK_OSCILLATOR]: { 'tension-flicker': 1.18, 'flicker-trust': 1.18, 'flicker-phase': 1.08 },
    [trustSystems.names.ENTROPY_REGULATOR]: { 'flicker-entropy': 1.22, 'density-entropy': 1.18, 'tension-entropy': 1.10, 'entropy-trust': 1.22, 'entropy-phase': 1.08 },
    [trustSystems.names.CONVERGENCE]: { 'tension-trust': 1.22, 'density-trust': 1.18, 'tension-phase': 1.06, 'density-phase': 1.04 },
    [trustSystems.names.REST_SYNCHRONIZER]: { 'density-trust': 1.20, 'flicker-trust': 1.15 },
  };

  function getSystemPairHotspotProfile(systemName) {
    const beatKey = adaptiveTrustScoresHelpersGetBeatKey();
    if (adaptiveTrustScoresHelpersHotspotCacheBeatKey !== beatKey) {
      adaptiveTrustScoresHelpersHotspotCacheBeatKey = beatKey;
      adaptiveTrustScoresHelpersHotspotCache.clear();
    }
    if (adaptiveTrustScoresHelpersHotspotCache.has(systemName)) {
      return adaptiveTrustScoresHelpersHotspotCache.get(systemName);
    }
    const pairList = pairAwareHotspotPairs[systemName] || ['density-trust', 'flicker-trust', 'tension-trust'];
    const pairWeights = pairAwarePairWeights[systemName] || {};
    const dynamics = safePreBoot.call(() => systemDynamicsProfiler.getSnapshot(), null);
    const couplingMatrix = dynamics ? dynamics.couplingMatrix : undefined;
    const adaptiveSnapshot = safePreBoot.call(() => pipelineCouplingManager.getAdaptiveTargetSnapshot(), null);
    if (!couplingMatrix) {
      const emptyProfile = { pressure: 0, dominantPair: '', hotspotPairs: [], severePressure: 0, severePair: '' };
      adaptiveTrustScoresHelpersHotspotCache.set(systemName, emptyProfile);
      return emptyProfile;
    }

    const hotspotPairs = [];
    let maxPressure = 0;
    let pressureSum = 0;
    let pressureCount = 0;
    let severePressure = 0;
    let severePair = '';
    for (let i = 0; i < pairList.length; i++) {
      const pair = pairList[i];
      const rawCorrelation = couplingMatrix[pair];
      if (typeof rawCorrelation !== 'number' || !Number.isFinite(rawCorrelation)) continue;
      const absCorrelation = m.abs(rawCorrelation);
      const adaptiveEntry = adaptiveSnapshot && adaptiveSnapshot[pair] && typeof adaptiveSnapshot[pair] === 'object'
        ? adaptiveSnapshot[pair]
        : null;
      const pairP95 = adaptiveEntry && typeof adaptiveEntry.p95AbsCorr === 'number' ? adaptiveEntry.p95AbsCorr : absCorrelation;
      const hotspotRate = adaptiveEntry && typeof adaptiveEntry.hotspotRate === 'number' ? adaptiveEntry.hotspotRate : 0;
      const severeRate = adaptiveEntry && typeof adaptiveEntry.severeRate === 'number' ? adaptiveEntry.severeRate : 0;
      const pairWeight = pairWeights[pair] !== undefined ? pairWeights[pair] : 1;
      const pairPressure = clamp(
        clamp((absCorrelation - 0.72) / 0.18, 0, 1) * 0.40 +
        clamp((pairP95 - 0.82) / 0.16, 0, 1) * 0.35 +
        hotspotRate * 0.15 +
        severeRate * 0.10,
        0,
        1
      ) * pairWeight;
      const pairSeverePressure = clamp(
        clamp((pairP95 - 0.88) / 0.12, 0, 1) * 0.55 +
        clamp((absCorrelation - 0.80) / 0.16, 0, 1) * 0.20 +
        clamp((severeRate - 0.04) / 0.12, 0, 1) * 0.25,
        0,
        1
      ) * pairWeight;
      if (pairPressure <= 0.02) continue;
      hotspotPairs.push({ pair, pressure: Number(pairPressure.toFixed(4)), severePressure: Number(pairSeverePressure.toFixed(4)) });
      maxPressure = m.max(maxPressure, pairPressure);
      pressureSum += pairPressure;
      pressureCount++;
      if (pairSeverePressure > severePressure) {
        severePressure = pairSeverePressure;
        severePair = pair;
      }
    }
    hotspotPairs.sort(function(a, b) { return b.pressure - a.pressure; });
    const meanPressure = pressureCount > 0 ? pressureSum / pressureCount : 0;
    const profile = {
      pressure: Number(clamp(maxPressure * 0.60 + meanPressure * 0.40, 0, 1).toFixed(4)),
      dominantPair: hotspotPairs.length > 0 ? hotspotPairs[0].pair : '',
      hotspotPairs: hotspotPairs.slice(0, 3),
      severePressure: Number(clamp(severePressure, 0, 1).toFixed(4)),
      severePair,
    };
    adaptiveTrustScoresHelpersHotspotCache.set(systemName, profile);
    return profile;
  }

  function getAdaptiveDominanceCaps(scoreBySystem, systemName, effectiveScore, trustCeiling, trustWeightMax) {
    const specificProfile = dominanceCapProfile[systemName];
    const profile = specificProfile || genericDominanceCapProfile;

    let runnerUpScore = 0;
    let meanScore = 0;
    let systemCount = 0;
    let dominantCountAbove06 = effectiveScore > 0.60 ? 1 : 0;
    for (const [otherName, otherState] of scoreBySystem.entries()) {
      if (otherName === systemName) continue;
      runnerUpScore = m.max(runnerUpScore, otherState.score);
      meanScore += otherState.score;
      systemCount++;
      if (otherState.score > 0.60) dominantCountAbove06++;
    }
    meanScore = systemCount > 0 ? meanScore / systemCount : effectiveScore;
    const leadScore = m.max(0, effectiveScore - runnerUpScore);
    const dominanceSpread = m.max(0, effectiveScore - meanScore);

    if (!specificProfile && effectiveScore < 0.58 && leadScore < 0.12) {
      return { scoreCeiling: trustCeiling, weightCap: trustWeightMax };
    }

    let coherentLockPressure = 0;
    let coherentSharePressure = 0;
    let lateRunPressure = 0;
    const readiness = safePreBoot.call(() => regimeClassifier.getTransitionReadiness(), null);
    if (readiness) {
      if (typeof readiness.runCoherentBeats === 'number') {
        coherentLockPressure = clamp((readiness.runCoherentBeats - 36) / 96, 0, 1);
      }
      if (typeof readiness.runCoherentShare === 'number') {
        coherentSharePressure = clamp((readiness.runCoherentShare - 0.46) / 0.22, 0, 1);
      }
      if (typeof readiness.runBeatCount === 'number') {
        lateRunPressure = clamp((readiness.runBeatCount - 48) / 96, 0, 1);
      }
    }

    let trustHotspotPressure = 0;
    const dynamics = safePreBoot.call(() => systemDynamicsProfiler.getSnapshot(), null);
    const couplingMatrix = dynamics ? dynamics.couplingMatrix : undefined;
    if (couplingMatrix) {
      const trustPairs = ['density-trust', 'flicker-trust', 'tension-trust', 'entropy-trust'];
      let maxTrustCorrelation = 0;
      let sumTrustCorrelation = 0;
      let trustPairCount = 0;
      for (let i = 0; i < trustPairs.length; i++) {
        const correlation = couplingMatrix[trustPairs[i]];
        if (typeof correlation !== 'number' || !Number.isFinite(correlation)) continue;
        const absCorrelation = m.abs(correlation);
        maxTrustCorrelation = m.max(maxTrustCorrelation, absCorrelation);
        sumTrustCorrelation += absCorrelation;
        trustPairCount++;
      }
      const avgTrustCorrelation = trustPairCount > 0 ? sumTrustCorrelation / trustPairCount : 0;
      trustHotspotPressure = clamp(
        clamp((maxTrustCorrelation - 0.72) / 0.18, 0, 1) * 0.65 +
        clamp((avgTrustCorrelation - 0.55) / 0.20, 0, 1) * 0.35,
        0,
        1
      );
    }

    let trustAxisPressure = 0;
    let phaseStarvationPressure = 0;
    const axisEnergy = safePreBoot.call(() => pipelineCouplingManager.getAxisEnergyShare(), null);
    if (axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.trust === 'number') {
      trustAxisPressure = clamp((axisEnergy.shares.trust - 0.19) / 0.09, 0, 1);
      if (typeof axisEnergy.shares.phase === 'number') {
        phaseStarvationPressure = clamp((0.08 - axisEnergy.shares.phase) / 0.08, 0, 1);
      }
    }

    let stickyTailPressure = 0;
    const homeostasis = safePreBoot.call(() => couplingHomeostasis.getState(), null);
    if (homeostasis && typeof homeostasis.stickyTailPressure === 'number') {
      stickyTailPressure = clamp(homeostasis.stickyTailPressure / 0.55, 0, 1);
    }
    const pairAwareProfile = getSystemPairHotspotProfile(systemName);
    const pairAwarePressure = pairAwareProfile.pressure;
    const pairAwareSeverePressure = pairAwareProfile.severePressure || 0;
    const trustSurfaceSystem = (pairAwareHotspotPairs[systemName] || []).some(function(pair) { return pair.indexOf('trust') >= 0; });
    const contextualScoreGetter = contextualTrust ? contextualTrust.getScore : undefined;
    const contextualScore = contextualScoreGetter ? contextualScoreGetter(systemName) : null;
    const contextualGap = contextualScore !== null
      ? clamp((effectiveScore - contextualScore) / 0.18, 0, 1)
      : 0;

    const settlementPressure = clamp(
      lateRunPressure *
      clamp((leadScore - 0.10) / 0.16, 0, 1) *
      (1 - clamp(trustHotspotPressure * 0.9 + trustAxisPressure * 0.7 + stickyTailPressure * 0.4 + pairAwarePressure * 0.55 + pairAwareSeverePressure * 0.48 + contextualGap * 0.35 + (trustSurfaceSystem ? phaseStarvationPressure * 0.45 : 0), 0, 1)),
      0,
      1
    );

    const dominancePressure = clamp(
      leadScore * 1.75 +
      dominanceSpread * 0.65 +
      coherentLockPressure * 0.30 +
      coherentSharePressure * 0.38 +
      trustHotspotPressure * 0.48 +
      pairAwarePressure * 0.60 +
      pairAwareSeverePressure * 0.50 +
      trustAxisPressure * 0.32 +
      (trustSurfaceSystem ? phaseStarvationPressure * 0.42 : 0) +
      stickyTailPressure * 0.24 +
      contextualGap * 0.24 +
      settlementPressure * 0.85 +
      clamp((dominantCountAbove06 - 1) / 2, 0, 1) * 0.18,
      0,
      1.60
    );

    const coherencePenalty = specificProfile && systemName === trustSystems.names.COHERENCE_MONITOR
      ? clamp(trustHotspotPressure * 0.25 + pairAwarePressure * 0.24 + pairAwareSeverePressure * 0.22 + trustAxisPressure * 0.20 + settlementPressure * 0.20 + stickyTailPressure * 0.12 + contextualGap * 0.12 + phaseStarvationPressure * 0.24, 0, 0.50)
      : 0;

    return {
      scoreCeiling: clamp(trustCeiling - (dominancePressure + coherencePenalty) * profile.scorePenalty, profile.scoreFloor, trustCeiling),
      weightCap: clamp(trustWeightMax - (dominancePressure + coherencePenalty) * profile.weightPenalty, profile.weightFloor, trustWeightMax),
    };
  }

  return {
    getAdaptiveDominanceCaps,
    getSystemPairHotspotProfile,
  };
})();
