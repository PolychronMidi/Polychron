regimeClassifierResolution = (() => {
  function activateForcedRegime(state, config, regime, reason, beatsRemaining, triggerStreak, triggerTickId) {
    state.forcedRegime = regime;
    state.forcedRegimeBeatsRemaining = beatsRemaining;
    state.forcedBreakCount++;
    state.lastForcedReason = reason;
    state.lastForcedTriggerStreak = state.V.optionalFinite(triggerStreak, 0);
    const triggerTick = state.V.optionalFinite(triggerTickId, 0);
    state.lastForcedTriggerTick = triggerTick > 0 ? triggerTick : state.runBeatCount + 1;
    state.lastForcedTriggerBeat = state.lastForcedTriggerTick;
    if (reason === 'coherent-cadence-monopoly' || reason === 'coherent-max-dwell-run') {
      state.postForcedRecoveryBeats = config.POST_FORCED_RECOVERY_WINDOW;
    }
    state.rawRegimeWindow.length = 0;
    state.pendingForcedTransitionEvent = {
      eventId: ++state.forcedTransitionEventSerial,
      from: state.lastRegime,
      to: regime,
      reason,
      triggerStreak: state.lastForcedTriggerStreak,
      triggerTick: state.lastForcedTriggerTick,
      runTickCount: state.runBeatCount,
      runTransitionCount: state.runTransitionCount,
      runCoherentBeats: state.runCoherentBeats,
      runCoherentShare: Number(state.runCoherentShare.toFixed(4)),
      forcedBeatsRemaining: beatsRemaining
    };
    explainabilityBus.emit('REGIME_FORCED_TRANSITION', 'both', {
      from: state.lastRegime,
      to: regime,
      reason,
      coherentBeats: state.coherentBeats,
      runCoherentBeats: state.runCoherentBeats,
      runCoherentShare: Number(state.runCoherentShare.toFixed(4)),
      exploringBeats: state.exploringBeats,
      evolvingBeats: state.evolvingBeats,
      triggerStreak: state.lastForcedTriggerStreak,
      triggerBeat: state.lastForcedTriggerBeat,
      triggerTick: state.lastForcedTriggerTick,
      forcedBeatsRemaining: beatsRemaining,
      thresholdScale: state.coherentThresholdScale
    });
  }

  function resolve(state, config, rawRegime, tickId, forceRegimeTransition) {
    const beatSpan = regimeClassifierHelpers.getTickSpan(state, tickId);
    const axisEnergy = safePreBoot.call(() => pipelineCouplingManager.getAxisEnergyShare(), null);
    const phaseShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.phase === 'number'
      ? axisEnergy.shares.phase
      : 0;
    const runExploringShare = state.runBeatCount > 0
      ? ((state.runResolvedRegimeCounts.exploring || 0) / state.runBeatCount)
      : 0;
    const shortFormPressure = state.V.optionalFinite(totalSections, 0) > 0 && totalSections <= 4 ? 1 : 0;
    const evolvingShare = state.runBeatCount > 0
      ? ((state.runResolvedRegimeCounts.evolving || 0) / state.runBeatCount)
      : 0;
    const evolvingDeficit = clamp((config.REGIME_TARGET_EVOLVING_LO - evolvingShare) / config.REGIME_TARGET_EVOLVING_LO, 0, 1);
    state.rawRegimeCounts[rawRegime] = (state.rawRegimeCounts[rawRegime] || 0) + 1;
    state.runRawRegimeCounts[rawRegime] = (state.runRawRegimeCounts[rawRegime] || 0) + beatSpan;

    if (rawRegime === state.rawStreakRegime) state.rawStreakCount++;
    else {
      state.rawStreakRegime = rawRegime;
      state.rawStreakCount = 1;
    }
    state.rawRegimeMaxStreak[rawRegime] = m.max(state.rawRegimeMaxStreak[rawRegime] || 0, state.rawStreakCount);

    let effectiveWindow = config.REGIME_WINDOW;
    if (state.lastRegime === 'exploring') {
      const exploringWindowReduction = phaseShare > 0.08 && runExploringShare > 0.68
        ? 0
        : m.floor(state.exploringBeats / 40);
      effectiveWindow = m.max(3, config.REGIME_WINDOW - exploringWindowReduction);
    }

    state.rawRegimeWindow.push(rawRegime);
    while (state.rawRegimeWindow.length > effectiveWindow) state.rawRegimeWindow.shift();

    if (state.forcedRegimeBeatsRemaining <= 0 && state.lastRegime === 'exploring' && state.exploringBeats >= config.EXPLORING_MAX_DWELL) {
      forceRegimeTransition('evolving', 'exploring-max-dwell', 3);
    }
    const exploringMonopolyThreshold = shortFormPressure > 0 ? 0.68 : 0.74;
    const exploringMonopolyMinDwell = shortFormPressure > 0
      ? m.max(12, m.floor(config.EXPLORING_MAX_DWELL * 0.45))
      : m.max(16, m.floor(config.EXPLORING_MAX_DWELL * 0.55));
    if (state.forcedRegimeBeatsRemaining <= 0 && state.lastRegime === 'exploring' && runExploringShare > exploringMonopolyThreshold && state.exploringBeats >= exploringMonopolyMinDwell) {
      forceRegimeTransition('evolving', 'exploring-share-monopoly', 4, state.exploringBeats, tickId);
    }

    let resolvedRegime = state.lastRegime;
    state.forcedOverrideActive = false;

    if (state.forcedRegimeBeatsRemaining > 0) {
      resolvedRegime = state.forcedRegime;
      state.forcedOverrideActive = true;
      state.forcedOverrideBeats++;
      state.forcedRegimeBeatsRemaining--;
      state.rawRegimeWindow.length = 0;
      if (state.forcedRegimeBeatsRemaining === 0) state.forcedRegime = '';
    } else if (rawRegime !== state.lastRegime && state.rawRegimeWindow.length >= (config.REGIME_MAJORITY - 1)) {
      let windowHits = 0;
      for (let i = 0; i < state.rawRegimeWindow.length; i++) {
        if (state.rawRegimeWindow[i] === rawRegime) windowHits++;
      }

      const phaseHealthyExploringPressure = phaseShare > 0.06
        ? clamp((runExploringShare - 0.68) / 0.12, 0, 1)
        : 0;
      const requiredHits = rawRegime === 'exploring'
        ? (phaseHealthyExploringPressure > 0 || shortFormPressure > 0 ? 3 : 2)
        : (rawRegime === 'evolving' && evolvingDeficit > 0.15 ? 2 : config.REGIME_MAJORITY);

      if (windowHits >= requiredHits) {
        let allowTransition = true;
        if (state.lastRegime === 'evolving' && state.evolvingBeats > config.EVOLVING_MAX_DWELL) {
          allowTransition = true;
        } else if (state.lastRegime === 'evolving' && rawRegime === 'coherent' && state.evolvingBeats < state.evolvingMinDwell) {
          allowTransition = false;
        }

        if (allowTransition) {
          explainabilityBus.emit('REGIME_TRANSITION', 'both', {
            from: state.lastRegime,
            to: rawRegime,
            coupling: state.lastClassifyInputs.couplingStrength,
            threshold: state.lastClassifyInputs.coherentThreshold,
            proximityBonus: state.lastClassifyInputs.evolvingProximityBonus,
            gap: state.lastClassifyInputs.couplingStrength - state.lastClassifyInputs.coherentThreshold,
            exploringBeats: state.lastRegime === 'exploring' ? state.exploringBeats + 1 : state.exploringBeats,
            evolvingBeats: state.lastRegime === 'evolving' ? state.evolvingBeats + 1 : state.evolvingBeats,
            windowHits
          });
          if (state.lastRegime === 'coherent') {
            state.coherentMomentumBeats = m.max(config.COHERENT_MOMENTUM_WINDOW, m.floor(state.coherentBeats * 0.25));
          }
          state.rawRegimeWindow.length = 0;
          resolvedRegime = rawRegime;
        }
      }
    }

    if (state.forcedRegimeBeatsRemaining <= 0 && resolvedRegime === 'coherent') {
      const projectedRunCoherentBeats = state.runLastResolvedRegime === 'coherent' ? state.runCoherentBeats + beatSpan : beatSpan;
      let coherentMaxDwell = config.COHERENT_MAX_DWELL;
      const lowPhaseThreshold = safePreBoot.call(() => phaseFloorController.getLowShareThreshold(), 0.03) || 0.03;
      if (phaseShare < lowPhaseThreshold) {
        const phaseCollapsePressure = clamp((lowPhaseThreshold - phaseShare) / m.max(lowPhaseThreshold, 0.01), 0, 1);
        coherentMaxDwell = m.max(48, m.round(config.COHERENT_MAX_DWELL * (1 - phaseCollapsePressure * 0.35)));
      }
      if (projectedRunCoherentBeats > coherentMaxDwell) {
        const coherentOvershoot = projectedRunCoherentBeats - coherentMaxDwell;
        const forcedWindow = clamp(4 + m.floor(coherentOvershoot / 24) + m.floor(state.coherentShareEma * 6), 4, 12);
        forceRegimeTransition('exploring', 'coherent-max-dwell-run', forcedWindow, projectedRunCoherentBeats, tickId);
        resolvedRegime = 'exploring';
        state.forcedOverrideActive = true;
        state.forcedOverrideBeats++;
        state.forcedRegimeBeatsRemaining = m.max(0, state.forcedRegimeBeatsRemaining - 1);
        state.rawRegimeWindow.length = 0;
        if (state.forcedRegimeBeatsRemaining === 0) state.forcedRegime = '';
      }
    }

    let monopolyState = regimeClassifierHelpers.computeCadenceMonopolyProjection(state, resolvedRegime, beatSpan);
    if (state.forcedRegimeBeatsRemaining <= 0 && resolvedRegime === 'coherent' && monopolyState.active && (
      rawRegime === 'exploring' ||
      rawRegime === 'evolving' ||
      monopolyState.rawNonCoherentOpportunityShare > 0.16 ||
      monopolyState.opportunityGap > 0.10
    )) {
      const forcedWindow = clamp(5 + m.floor(monopolyState.pressure * 5), 5, 9);
      forceRegimeTransition(monopolyState.preferredRegime, 'coherent-cadence-monopoly', forcedWindow, state.runCoherentBeats + beatSpan, tickId);
      resolvedRegime = monopolyState.preferredRegime;
      state.forcedOverrideActive = true;
      state.forcedOverrideBeats++;
      state.forcedRegimeBeatsRemaining = m.max(0, state.forcedRegimeBeatsRemaining - 1);
      state.rawRegimeWindow.length = 0;
      if (state.forcedRegimeBeatsRemaining === 0) state.forcedRegime = '';
      monopolyState = regimeClassifierHelpers.computeCadenceMonopolyProjection(state, resolvedRegime, beatSpan);
    }

    state.cadenceMonopolyPressure = monopolyState.pressure;
    state.cadenceMonopolyActive = monopolyState.active;
    state.cadenceMonopolyReason = monopolyState.reason;

    if (resolvedRegime === 'exploring') {
      state.exploringBeats++;
      state.coherentBeats = 0;
      state.evolvingBeats = 0;
    } else if (resolvedRegime === 'coherent') {
      state.coherentBeats++;
      state.exploringBeats = 0;
      state.evolvingBeats = 0;
    } else if (resolvedRegime === 'evolving') {
      state.evolvingBeats++;
      state.exploringBeats = 0;
      state.coherentBeats = 0;
    } else {
      state.exploringBeats = 0;
      state.coherentBeats = 0;
      state.evolvingBeats = 0;
    }

    regimeClassifierHelpers.updateRunResolvedTelemetry(state, resolvedRegime, beatSpan);
    state.lastRegime = resolvedRegime;
    return resolvedRegime;
  }

  return { activateForcedRegime, resolve };
})();
