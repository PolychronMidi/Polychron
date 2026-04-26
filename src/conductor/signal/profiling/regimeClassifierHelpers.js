moduleLifecycle.declare({
  name: 'regimeClassifierHelpers',
  subsystem: 'conductor',
  deps: ['validator'],
  provides: ['regimeClassifierHelpers'],
  init: (deps) => {
  const V = deps.validator.create('regimeClassifierHelpers');
  function getTickSpan(state, tickId) {
    const currentTick = state.V.optionalFinite(tickId, 0);
    if (currentTick <= 0) return 1;
    if (state.lastObservedTickId <= 0) {
      state.lastObservedTickId = currentTick;
      return 1;
    }
    const delta = currentTick - state.lastObservedTickId;
    state.lastObservedTickId = currentTick;
    return delta > 0 ? delta : 1;
  }

  function updateRunResolvedTelemetry(state, resolvedRegime, beatSpan) {
    const span = m.max(1, state.V.optionalFinite(beatSpan, 1));
    if (state.runBeatCount > 0 && resolvedRegime !== state.runLastResolvedRegime) {
      state.runTransitionCount++;
    }
    state.runBeatCount += span;
    state.runResolvedRegimeCounts[resolvedRegime] = (state.runResolvedRegimeCounts[resolvedRegime] ?? 0) + span;

    if (resolvedRegime === 'coherent') {
      state.runCoherentBeats = state.runLastResolvedRegime === 'coherent' ? state.runCoherentBeats + span : span;
      state.runMaxCoherentBeats = m.max(state.runMaxCoherentBeats, state.runCoherentBeats);
    } else {
      state.runCoherentBeats = 0;
    }

    state.runLastResolvedRegime = resolvedRegime;
    state.runCoherentShare = state.runBeatCount > 0
      ? (V.optionalFinite(state.runResolvedRegimeCounts.coherent, 0)) / state.runBeatCount
      : 0;
  }

  function computeCadenceMonopolyProjection(state, resolvedRegime, beatSpan) {
    const span = m.max(1, state.V.optionalFinite(beatSpan, 1));
    const projectedRunBeatCount = state.runBeatCount + span;
    const projectedResolvedCounts = Object.assign({}, state.runResolvedRegimeCounts);
    projectedResolvedCounts[resolvedRegime] = (projectedResolvedCounts[resolvedRegime] ?? 0) + span;
    const projectedCoherentShare = projectedRunBeatCount > 0
      ? (V.optionalFinite(projectedResolvedCounts.coherent, 0)) / projectedRunBeatCount
      : 0;
    const rawExploringShare = projectedRunBeatCount > 0
      ? ((V.optionalFinite(state.runRawRegimeCounts.exploring, 0)) / projectedRunBeatCount)
      : 0;
    const rawEvolvingShare = projectedRunBeatCount > 0
      ? ((V.optionalFinite(state.runRawRegimeCounts.evolving, 0)) / projectedRunBeatCount)
      : 0;
    const rawNonCoherentOpportunityShare = rawExploringShare + rawEvolvingShare;
    const resolvedNonCoherentShare = projectedRunBeatCount > 0
      ? (((V.optionalFinite(projectedResolvedCounts.exploring, 0)) + (V.optionalFinite(projectedResolvedCounts.evolving, 0))) / projectedRunBeatCount)
      : 0;
    const opportunityGap = m.max(0, rawNonCoherentOpportunityShare - resolvedNonCoherentShare);
    const projectedTransitionCount = state.runTransitionCount + (state.runBeatCount > 0 && resolvedRegime !== state.runLastResolvedRegime ? 1 : 0);
    const transitionScarcity = projectedRunBeatCount > 24
      ? clamp((0.055 - (projectedTransitionCount / projectedRunBeatCount)) / 0.055, 0, 1)
      : 0;
    const rawOpportunityPressure = clamp(rawNonCoherentOpportunityShare / 0.20, 0, 1);
    const monopolyPressure = clamp(
      // R9 E5: Raised coherent share threshold 0.53->0.55 to allow more coherent
      // regime. R8b coherent was 8.7% (too low). 0.55 should target ~15-20%.
      // History: 0.58 (original) -> 0.50 (R8a, too aggressive) -> 0.53 (R8b) -> 0.55 (R9).
      clamp((projectedCoherentShare - 0.55) / 0.18, 0, 1) * 0.44 +
      clamp(opportunityGap / 0.22, 0, 1) * 0.34 +
      transitionScarcity * 0.12 +
      (projectedRunBeatCount > 18 && (V.optionalFinite(projectedResolvedCounts.exploring, 0)) === 0 ? 0.10 : 0) +
      clamp((0.08 - rawExploringShare) / 0.08, 0, 1) * 0.04 +
      rawOpportunityPressure * 0.06,
      0,
      1
    );
    let reason = '';
    if (opportunityGap > 0.12) reason = 'raw-noncoherent-suppressed';
    else if (projectedCoherentShare > 0.64) reason = 'coherent-share-monopoly';
    else if (transitionScarcity > 0.60) reason = 'transition-scarcity';

    return {
      pressure: Number(monopolyPressure.toFixed(4)),
      active: projectedRunBeatCount > 16 && monopolyPressure > 0.48,
      reason,
      preferredRegime: rawExploringShare >= rawEvolvingShare ? 'exploring' : 'evolving',
      rawExploringShare: Number(rawExploringShare.toFixed(4)),
      rawEvolvingShare: Number(rawEvolvingShare.toFixed(4)),
      rawNonCoherentOpportunityShare: Number(rawNonCoherentOpportunityShare.toFixed(4)),
      resolvedNonCoherentShare: Number(resolvedNonCoherentShare.toFixed(4)),
      opportunityGap: Number(opportunityGap.toFixed(4)),
    };
  }

  function buildTransitionReadiness(state) {
    const cadenceOpportunityPressure = clamp((V.optionalFinite(state.lastClassifyInputs.opportunityGap, 0)) / 0.20, 0, 1);
    const evolvingElapsedSec = beatStartTime - state.evolvingStartSec;
    const exploringVelocityThreshold = (evolvingElapsedSec > 83 ? 0.010 : 0.012) - (V.optionalFinite(state.lastClassifyInputs.cadenceMonopolyPressure, 0)) * 0.003 - cadenceOpportunityPressure * 0.001;
    let exploringBlock = 'none';
    if (state.lastClassifyInputs.velocity <= exploringVelocityThreshold) exploringBlock = 'velocity';
    else if ((V.optionalFinite(state.lastClassifyInputs.effectiveDim, 0)) <= 2.5) exploringBlock = 'dimension';
    else if (state.lastClassifyInputs.couplingStrength > 0.50 + (V.optionalFinite(state.lastClassifyInputs.cadenceMonopolyPressure, 0)) * 0.08 + cadenceOpportunityPressure * 0.06) exploringBlock = 'coupling';

    let coherentBlock = 'none';
    if (state.lastClassifyInputs.couplingStrength <= state.lastClassifyInputs.coherentThreshold) coherentBlock = 'coupling';
    else if (state.lastClassifyInputs.velocity <= state.lastClassifyInputs.velThreshold) coherentBlock = 'velocity';
    else if ((V.optionalFinite(state.lastClassifyInputs.effectiveDim, 0)) > 4.0 - (V.optionalFinite(state.lastClassifyInputs.cadenceMonopolyPressure, 0)) * 0.55 - cadenceOpportunityPressure * 0.35) coherentBlock = 'dimension';

    return {
      gap: Number((state.lastClassifyInputs.couplingStrength - state.lastClassifyInputs.coherentThreshold).toFixed(4)),
      couplingStrength: Number(state.lastClassifyInputs.couplingStrength.toFixed(4)),
      coherentThreshold: Number(state.lastClassifyInputs.coherentThreshold.toFixed(4)),
      velocity: Number(state.lastClassifyInputs.velocity.toFixed(6)),
      velThreshold: state.lastClassifyInputs.velThreshold,
      thresholdScale: Number(state.coherentThresholdScale.toFixed(4)),
      velocityBlocked: state.lastClassifyInputs.couplingStrength > state.lastClassifyInputs.coherentThreshold && state.lastClassifyInputs.velocity <= state.lastClassifyInputs.velThreshold,
      exploringBlock,
      coherentBlock,
      evolvingBeats: state.evolvingBeats,
      coherentBeats: state.coherentBeats,
      runCoherentBeats: state.runCoherentBeats,
      maxCoherentBeats: state.runMaxCoherentBeats,
      runBeatCount: state.runBeatCount,
      runTickCount: state.runBeatCount,
      runCoherentShare: Number(state.runCoherentShare.toFixed(4)),
      runTransitionCount: state.runTransitionCount,
      forcedBreakCount: state.forcedBreakCount,
      forcedRegime: state.forcedRegime,
      forcedRegimeBeatsRemaining: state.forcedRegimeBeatsRemaining,
      forcedOverrideActive: state.forcedOverrideActive,
      forcedOverrideBeats: state.forcedOverrideBeats,
      lastForcedReason: state.lastForcedReason,
      lastForcedTriggerStreak: state.lastForcedTriggerStreak,
      lastForcedTriggerBeat: state.lastForcedTriggerBeat,
      lastForcedTriggerTick: state.lastForcedTriggerTick,
      postForcedRecoveryBeats: state.postForcedRecoveryBeats,
      postForcedRecoveryRemainingSec: beatStartTime < state.postForcedRecoveryEndSec ? state.postForcedRecoveryEndSec - beatStartTime : 0,
      tickSource: state.tickSource,
      rawRegimeCounts: Object.assign({}, state.rawRegimeCounts),
      runRawRegimeCounts: Object.assign({}, state.runRawRegimeCounts),
      rawRegimeMaxStreak: Object.assign({}, state.rawRegimeMaxStreak),
      runResolvedRegimeCounts: Object.assign({}, state.runResolvedRegimeCounts),
      effectiveDim: Number(((V.optionalFinite(state.lastClassifyInputs.effectiveDim, 0))).toFixed(4)),
      cadenceMonopolyPressure: Number(state.cadenceMonopolyPressure.toFixed(4)),
      cadenceMonopolyActive: state.cadenceMonopolyActive,
      cadenceMonopolyReason: state.cadenceMonopolyReason,
      rawExploringShare: Number((V.optionalFinite(state.lastClassifyInputs.rawExploringShare, 0)).toFixed(4)),
      rawEvolvingShare: Number((V.optionalFinite(state.lastClassifyInputs.rawEvolvingShare, 0)).toFixed(4)),
      rawNonCoherentOpportunityShare: Number((V.optionalFinite(state.lastClassifyInputs.rawNonCoherentOpportunityShare, 0)).toFixed(4)),
      resolvedNonCoherentShare: Number((V.optionalFinite(state.lastClassifyInputs.resolvedNonCoherentShare, 0)).toFixed(4)),
      opportunityGap: Number((V.optionalFinite(state.lastClassifyInputs.opportunityGap, 0)).toFixed(4)),
    };
  }

  return {
    buildTransitionReadiness,
    computeCadenceMonopolyProjection,
    getTickSpan,
    updateRunResolvedTelemetry,
  };
  },
});
