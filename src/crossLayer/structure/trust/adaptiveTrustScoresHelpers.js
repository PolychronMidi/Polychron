adaptiveTrustScoresHelpers = (() => {
  const V = validator.create('adaptiveTrustScoresHelpers');
  let adaptiveTrustScoresHelpersHotspotCacheBeatKey = '';
  const adaptiveTrustScoresHelpersHotspotCache = new Map();

  function adaptiveTrustScoresHelpersGetBeatKey() {
    const safeSection = Number.isFinite(sectionIndex) ? sectionIndex : -1;
    const safePhrase = Number.isFinite(phraseIndex) ? phraseIndex : -1;
    const safeBeat = Number.isFinite(beatStartTime) ? beatStartTime : (Number.isFinite(beatCount) ? beatCount : -1);
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
    // Per-system pair assignments to prevent identical hotspot blocks.
    // Each system measured against the coupling axes most relevant to its function.
    [trustSystems.names.MOTIF_ECHO]: ['density-trust', 'tension-trust', 'density-phase'],
    [trustSystems.names.TEMPORAL_GRAVITY]: ['tension-phase', 'density-phase', 'tension-trust'],
    [trustSystems.names.HARMONIC_INTERVAL_GUARD]: ['tension-trust', 'density-trust', 'tension-entropy'],
    [trustSystems.names.CROSS_LAYER_SILHOUETTE]: ['density-trust', 'density-phase', 'density-entropy'],
    [trustSystems.names.ROLE_SWAP]: ['density-trust', 'tension-trust', 'flicker-trust'],
    [trustSystems.names.DYNAMIC_ENVELOPE]: ['tension-trust', 'density-trust', 'tension-flicker'],
    // grooveTransfer: groove propagation = density-to-phase flow + tension-driven variation
    [trustSystems.names.GROOVE_TRANSFER]: ['density-phase', 'density-flicker', 'tension-phase'],
    [trustSystems.names.CLIMAX_ENGINE]: ['tension-trust', 'density-trust', 'tension-phase'],
    [trustSystems.names.VELOCITY_INTERFERENCE]: ['density-trust', 'tension-trust', 'density-flicker'],
    // rhythmicComplement: fills sparse moments = entropy/phase when main layer is quiet
    [trustSystems.names.RHYTHMIC_COMPLEMENT]: ['density-entropy', 'density-phase', 'tension-entropy'],
    [trustSystems.names.SPECTRAL_COMPLEMENTARITY]: ['density-trust', 'tension-entropy', 'density-entropy'],
    [trustSystems.names.REGISTER_COLLISION_AVOIDER]: ['density-trust', 'tension-trust', 'density-entropy'],
    [trustSystems.names.TEXTURAL_MIRROR]: ['density-trust', 'density-flicker', 'flicker-trust'],
    [trustSystems.names.VERTICAL_INTERVAL_MONITOR]: ['tension-trust', 'density-trust', 'tension-entropy'],
    [trustSystems.names.ARTICULATION_COMPLEMENT]: ['density-flicker', 'tension-flicker', 'flicker-trust'],
    [trustSystems.names.CONVERGENCE_HARMONIC_TRIGGER]: ['tension-trust', 'tension-phase', 'density-trust'],
    [trustSystems.names.POLYRHYTHMIC_PHASE_PREDICTOR]: ['density-phase', 'flicker-phase', 'tension-phase'],
    [trustSystems.names.EMERGENT_DOWNBEAT]: ['density-phase', 'density-trust', 'tension-phase'],
    [trustSystems.names.PHASE_AWARE_CADENCE_WINDOW]: ['tension-phase', 'density-phase', 'tension-trust'],
  };
  const pairAwarePairWeights = {
    [trustSystems.names.COHERENCE_MONITOR]: { 'density-trust': 1.26, 'flicker-trust': 1.28, 'tension-trust': 1.08 },
    [trustSystems.names.PHASE_LOCK]: { 'flicker-phase': 1.20, 'density-phase': 1.10, 'tension-phase': 1.05, 'trust-phase': 1.05 },
    [trustSystems.names.CADENCE_ALIGNMENT]: { 'tension-trust': 1.25, 'density-trust': 1.16, 'density-phase': 1.08 },
    [trustSystems.names.STUTTER_CONTAGION]: { 'density-flicker': 1.25, 'flicker-phase': 1.10, 'flicker-trust': 1.22 },
    [trustSystems.names.FEEDBACK_OSCILLATOR]: { 'tension-flicker': 1.18, 'flicker-trust': 1.24, 'flicker-phase': 1.08 },
    [trustSystems.names.ENTROPY_REGULATOR]: { 'flicker-entropy': 1.22, 'density-entropy': 1.18, 'tension-entropy': 1.10, 'entropy-trust': 1.22, 'entropy-phase': 1.08 },
    [trustSystems.names.CONVERGENCE]: { 'tension-trust': 1.22, 'density-trust': 1.18, 'tension-phase': 1.06, 'density-phase': 1.04 },
    [trustSystems.names.REST_SYNCHRONIZER]: { 'density-trust': 1.20, 'flicker-trust': 1.22 },
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
    const pairWeights = pairAwarePairWeights[systemName] || /** @type {Record<string, number>} */ ({});
    const couplingPressures = (safePreBoot.call(() => pipelineCouplingManager.getCouplingPressures(), {})) || {};
    const signals = safePreBoot.call(() => conductorSignalBridge.getSignals(), /** @type {any} */ ({}));
    const adaptiveSnapshot = signals.adaptiveTargetSnapshot || null;
    // Attenuate density-pair pressure when conductor intentionally suppresses density.
    // Low densityProduct + high density-axis correlation = axes moving together (expected), not stressed.
    const densityProduct = V.optionalFinite(signals.density, 1.0);
    const densityAttenuation = clamp(densityProduct / 0.75, 0.5, 1.0);
    // Attenuate flicker-pair pressure when flicker is subdued (e.g. smooth-tension coupling label).
    // Analogous to density-attenuation: systems measured against flicker pairs should not be
    // penalized when the composition intentionally reduces flicker activity.
    const flickerProduct = V.optionalFinite(signals.flicker, 1.0);
    const flickerAttenuation = clamp(flickerProduct / 0.75, 0.5, 1.0);
    // Discount hotspot pressure for semantically labeled "opposed" pairs.
    // Creative anti-correlations (phase-opposed-flicker, smooth-tension, etc.) are structural
    // features of the composition, not failures -- penalizing them suppresses valid patterns.
    const couplingLabels = (signals.couplingLabels && typeof signals.couplingLabels === 'object')
      ? signals.couplingLabels : null;

    const hotspotPairs = [];
    let maxPressure = 0;
    let pressureSum = 0;
    let pressureCount = 0;
    let severePressure = 0;
    let severePair = '';
    let trustSurfacePressureSum = 0;
    let trustSurfaceCount = 0;
    let trustHotPairCount = 0;
    for (let i = 0; i < pairList.length; i++) {
      const pair = pairList[i];
      const absCorrelation = V.optionalFinite(couplingPressures[pair], -1);
      if (absCorrelation < 0) continue;
      const adaptiveEntry = adaptiveSnapshot && adaptiveSnapshot[pair] && typeof adaptiveSnapshot[pair] === 'object'
        ? adaptiveSnapshot[pair]
        : null;
      const pairP95 = adaptiveEntry && typeof adaptiveEntry.p95AbsCorr === 'number' ? adaptiveEntry.p95AbsCorr : absCorrelation;
      const hotspotRate = adaptiveEntry && typeof adaptiveEntry.hotspotRate === 'number' ? adaptiveEntry.hotspotRate : 0;
      const severeRate = adaptiveEntry && typeof adaptiveEntry.severeRate === 'number' ? adaptiveEntry.severeRate : 0;
      // Attenuate if pair has a recognized creative "opposed" coupling label:
      // these are structural anti-correlations by design, not underperformance.
      const pairLabel = couplingLabels ? (couplingLabels[pair] || '') : '';
      const opposedDiscount = (pairLabel.indexOf('opposed') >= 0 || pairLabel === 'smooth-tension') ? 0.70 : 1.0;
      const pairWeight = (pairWeights[pair] !== undefined ? pairWeights[pair] : 1) *
        (pair.indexOf('density') >= 0 ? densityAttenuation : 1) *
        (pair.indexOf('flicker') >= 0 ? flickerAttenuation : 1) *
        opposedDiscount;
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
      if (pair.indexOf('trust') >= 0) {
        trustSurfacePressureSum += pairPressure;
        trustSurfaceCount++;
        if (pairPressure >= 0.18 || pairSeverePressure >= 0.16) {
          trustHotPairCount++;
        }
      }
      if (pairSeverePressure > severePressure) {
        severePressure = pairSeverePressure;
        severePair = pair;
      }
    }
    hotspotPairs.sort(function(a, b) { return b.pressure - a.pressure; });
    const meanPressure = pressureCount > 0 ? pressureSum / pressureCount : 0;
    const trustSurfacePressure = trustSurfaceCount > 0 ? trustSurfacePressureSum / trustSurfaceCount : 0;
    const trustClusterPressure = clamp(
      clamp((trustHotPairCount - 1) / 2, 0, 1) * 0.18 + trustSurfacePressure * 0.12,
      0,
      0.28
    );
    const profile = {
      pressure: Number(clamp(maxPressure * 0.56 + meanPressure * 0.32 + trustClusterPressure, 0, 1).toFixed(4)),
      dominantPair: hotspotPairs.length > 0 ? hotspotPairs[0].pair : '',
      hotspotPairs: hotspotPairs.slice(0, 3),
      severePressure: Number(clamp(severePressure + trustClusterPressure * 0.55, 0, 1).toFixed(4)),
      severePair,
      trustSurfacePressure: Number(clamp(trustSurfacePressure, 0, 1).toFixed(4)),
      trustHotPairCount,
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
    const trustCouplingPressures = (safePreBoot.call(() => pipelineCouplingManager.getCouplingPressures(), {})) || {};
    {
      const trustPairs = ['density-trust', 'flicker-trust', 'tension-trust', 'entropy-trust'];
      let maxTrustCorrelation = 0;
      let sumTrustCorrelation = 0;
      let trustPairCount = 0;
      for (let i = 0; i < trustPairs.length; i++) {
        const absCorrelation = V.optionalFinite(trustCouplingPressures[trustPairs[i]], -1);
        if (absCorrelation < 0) continue;
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
    const axisEnergyShares = safePreBoot.call(() => conductorSignalBridge.getSignals().axisEnergyShares, null);
    if (axisEnergyShares && typeof axisEnergyShares.trust === 'number') {
      trustAxisPressure = clamp((axisEnergyShares.trust - 0.19) / 0.09, 0, 1);
      if (typeof axisEnergyShares.phase === 'number') {
        phaseStarvationPressure = clamp((0.08 - axisEnergyShares.phase) / 0.08, 0, 1);
      }
    }

    let stickyTailPressure = 0;
    const homeostasis = safePreBoot.call(() => couplingHomeostasis.getState(), null);
    if (homeostasis && typeof homeostasis.stickyTailPressure === 'number') {
      stickyTailPressure = clamp(homeostasis.stickyTailPressure / 0.55, 0, 1);
    }
    const pairAwareProfile = getSystemPairHotspotProfile(systemName);
    const pairAwarePressure = pairAwareProfile.pressure;
    const pairAwareSeverePressure = V.optionalFinite(pairAwareProfile.severePressure, 0);
    const trustSurfacePressure = V.optionalFinite(pairAwareProfile.trustSurfacePressure, 0);
    const trustClusterPressure = clamp((V.optionalFinite(pairAwareProfile.trustHotPairCount, 0)) > 1 ? trustSurfacePressure * 0.45 + 0.10 : 0, 0, 0.28);
    const trustSurfaceSystem = (pairAwareHotspotPairs[systemName] || /** @type {string[]} */ ([])).some(function(pair) { return pair.indexOf('trust') >= 0; });
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
      trustSurfacePressure * 0.28 +
      trustClusterPressure * 0.36 +
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
      ? clamp(trustHotspotPressure * 0.25 + pairAwarePressure * 0.24 + pairAwareSeverePressure * 0.22 + trustSurfacePressure * 0.16 + trustClusterPressure * 0.18 + trustAxisPressure * 0.20 + settlementPressure * 0.20 + stickyTailPressure * 0.12 + contextualGap * 0.12 + phaseStarvationPressure * 0.24, 0, 0.50)
      : 0;

    return {
      scoreCeiling: clamp(trustCeiling - (dominancePressure + coherencePenalty) * profile.scorePenalty, profile.scoreFloor, trustCeiling),
      weightCap: clamp(trustWeightMax - (dominancePressure + coherencePenalty) * profile.weightPenalty, profile.weightFloor, trustWeightMax),
    };
  }

  /**
   * Apply all 6 cascading trust brake conditions to hotspotAwareWeight.
   * Extracted from adaptiveTrustScores.getWeight() to keep the main weight
   * function as structural flow only.
   * @param {string} systemName
   * @param {{ pressure: number, severePressure: number, dominantPair: string, severePair: string }} profile
   * @param {{ regime: string, tensionShare: number, trustShare: number, phaseShare: number, trustAxisPressure: number, phaseLaneNeed: number }} context
   * @param {number} weight
   * @param {number} trustClusterPressure
   * @param {number} trustSurfacePressure
   * @returns {number}
   */
  function applyTrustBrakes(systemName, profile, context, weight, trustClusterPressure, trustSurfacePressure) {
    let w = weight;
    if ((systemName === trustSystems.names.CADENCE_ALIGNMENT || systemName === trustSystems.names.CONVERGENCE)
      && context.regime === 'exploring'
      && (profile.dominantPair === 'density-trust' || (profile.dominantPair === 'density-flicker' && context.trustShare > 0.17))) {
      const densityTrustBrake = clamp(profile.pressure * 0.24 + profile.severePressure * 0.20 + clamp((context.trustShare - 0.17) / 0.07, 0, 1) * 0.10, 0.10, 0.34);
      w *= 1 - densityTrustBrake;
    }
    if ((systemName === trustSystems.names.STUTTER_CONTAGION || systemName === trustSystems.names.REST_SYNCHRONIZER || systemName === trustSystems.names.COHERENCE_MONITOR)
      && (profile.dominantPair === 'flicker-trust' || profile.dominantPair === 'density-flicker' || profile.dominantPair === 'density-trust')) {
      const lowPhasePressure = clamp((0.05 - context.phaseShare) / 0.05, 0, 1);
      const trustAxisPressure = clamp((context.trustShare - 0.17) / 0.08, 0, 1);
      const flickerTrustBrake = clamp(profile.pressure * 0.20 + profile.severePressure * 0.20 + lowPhasePressure * 0.14 + trustAxisPressure * 0.16, 0.08, 0.34);
      w *= 1 - flickerTrustBrake;
    }
    if (systemName === trustSystems.names.ENTROPY_REGULATOR
      && (profile.dominantPair === 'entropy-trust' || profile.severePair === 'entropy-trust')) {
      const entropyTrustBrake = clamp(profile.pressure * 0.22 + profile.severePressure * 0.22 + clamp((context.trustShare - 0.15) / 0.06, 0, 1) * 0.08, 0.10, 0.30);
      w *= 1 - entropyTrustBrake;
    }
    if ((systemName === trustSystems.names.CADENCE_ALIGNMENT || systemName === trustSystems.names.CONVERGENCE || systemName === trustSystems.names.COHERENCE_MONITOR)
      && context.regime === 'exploring'
      && profile.dominantPair === 'tension-trust') {
      const tensionTrustBrake = clamp(profile.pressure * 0.20 + profile.severePressure * 0.18 + clamp((context.tensionShare - 0.18) / 0.08, 0, 1) * 0.12, 0.10, 0.32);
      w *= 1 - tensionTrustBrake;
    }
    if (context.trustShare > 0.17 && profile.pressure > 0.15) {
      const dominanceBrake = clamp(context.trustAxisPressure * 0.10 + context.phaseLaneNeed * 0.12 + profile.pressure * 0.08 + profile.severePressure * 0.08, 0, 0.28);
      w *= 1 - dominanceBrake;
    }
    if (trustSurfacePressure > 0.12) {
      const trustSurfaceBrake = clamp(trustSurfacePressure * 0.18 + trustClusterPressure * 0.24 + profile.severePressure * 0.10 + context.trustAxisPressure * 0.08, 0.06, 0.30);
      w *= 1 - trustSurfaceBrake;
    }
    return w;
  }

  return {
    getAdaptiveDominanceCaps,
    getSystemPairHotspotProfile,
    applyTrustBrakes,
  };
})();
