regimeClassifierResolution = (() => {
  const V = validator.create('regimeClassifierResolution');
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
      state.postForcedRecoveryEndSec = beatStartTime + config.POST_FORCED_RECOVERY_SEC;
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
    }, undefined, 'forced-' + reason);
    L0.post('regimeTransition', 'both', beatStartTime, { from: state.lastRegime, to: regime, cause: 'forced-' + reason });
  }

  function resolve(state, config, rawRegime, tickId, forceRegimeTransition) {
    const beatSpan = regimeClassifierHelpers.getTickSpan(state, tickId);
    const exploringElapsedSec = beatStartTime - state.exploringStartSec;
    const coherentElapsedSec = beatStartTime - state.coherentStartSec;
    const evolvingElapsedSec = beatStartTime - state.evolvingStartSec;
    const axisEnergy = safePreBoot.call(() => pipelineCouplingManager.getAxisEnergyShare(), null);
    const phaseShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.phase === 'number'
      ? axisEnergy.shares.phase
      : 0;
    const trustShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.trust === 'number'
      ? axisEnergy.shares.trust
      : 0;
    const runExploringShare = state.runBeatCount > 0
      ? ((V.optionalFinite(state.runResolvedRegimeCounts.exploring, 0)) / state.runBeatCount)
      : 0;
    const shortFormPressure = state.V.optionalFinite(totalSections, 0) > 0 && totalSections <= 4 ? 1 : 0;
    const evolvingShare = state.runBeatCount > 0
      ? ((V.optionalFinite(state.runResolvedRegimeCounts.evolving, 0)) / state.runBeatCount)
      : 0;
    const evolvingDeficit = clamp((config.REGIME_TARGET_EVOLVING_LO - evolvingShare) / config.REGIME_TARGET_EVOLVING_LO, 0, 1);
    // Chronic forcing mitigation: if forced breaks are frequent, ease classification thresholds
    const forcedBreakPressure = state.forcedBreakCount > 3 ? clamp((state.forcedBreakCount - 3) * 0.02, 0, 0.08) : 0;
    const coherentOvershare = clamp((state.runCoherentShare - config.REGIME_TARGET_COHERENT_HI - forcedBreakPressure) / 0.18, 0, 1);
    const trustSharePressure = clamp((trustShare - 0.17) / 0.08, 0, 1);
    const phaseWeakness = clamp((0.07 - phaseShare) / 0.07, 0, 1);
    const phaseRecoveryCredit = clamp((phaseShare - 0.10) / 0.06, 0, 1);
    const phaseStableRecoveryBase = phaseShare > 0.05 && trustSharePressure < 0.30 && evolvingDeficit > 0.20;
    const phaseStableRecoveryStrength = phaseStableRecoveryBase ? clamp((phaseShare - 0.05) / 0.06, 0.3, 1) : 0;
    const phaseStableRecoveryWindow = phaseStableRecoveryBase;
    const evolvingPolishPressure = phaseShare > 0.05
      ? clamp((0.29 - evolvingShare) / 0.04, 0, 1) * (0.35 + phaseRecoveryCredit * 0.25 + (phaseStableRecoveryWindow ? 0.10 * phaseStableRecoveryStrength : 0))
      : 0;
    const evolvingRecoveryPriority = phaseShare > 0.02
      ? clamp(evolvingDeficit * (0.6 + phaseRecoveryCredit * 0.25 + coherentOvershare * 0.3 + (phaseStableRecoveryWindow ? 0.18 : 0)) + evolvingPolishPressure * 0.10 - trustSharePressure * 0.08, 0, 1)
      : 0;
    state.rawRegimeCounts[rawRegime] = (V.optionalFinite(state.rawRegimeCounts[rawRegime], 0)) + 1;
    state.runRawRegimeCounts[rawRegime] = (V.optionalFinite(state.runRawRegimeCounts[rawRegime], 0)) + beatSpan;

    if (rawRegime === state.rawStreakRegime) state.rawStreakCount++;
    else {
      state.rawStreakRegime = rawRegime;
      state.rawStreakCount = 1;
    }
    state.rawRegimeMaxStreak[rawRegime] = m.max(V.optionalFinite(state.rawRegimeMaxStreak[rawRegime], 0), state.rawStreakCount);

    let effectiveWindow = config.REGIME_WINDOW;
    if (state.lastRegime === 'exploring') {
      const exploringWindowReduction = phaseShare > 0.08 && runExploringShare > 0.68 && trustSharePressure < 0.20 && evolvingDeficit < 0.20
        ? 0
        : m.floor(state.exploringBeats / 40) + m.floor((trustSharePressure + evolvingDeficit * 0.8 + phaseWeakness * 0.6) * 2);
      effectiveWindow = m.max(3, config.REGIME_WINDOW - exploringWindowReduction);
    }

    state.rawRegimeWindow.push(rawRegime);
    while (state.rawRegimeWindow.length > effectiveWindow) state.rawRegimeWindow.shift();

    if (state.forcedRegimeBeatsRemaining <= 0 && state.lastRegime === 'exploring' && exploringElapsedSec >= config.EXPLORING_MAX_DWELL_SEC) {
      const exploringForcedWindow = clamp(6 + m.floor(evolvingDeficit * 6), 6, 12);
      // If evolving is well-represented, break toward coherent; otherwise recover evolving.
      // R46: Lowered threshold 0.18->0.12. At 0.18, priority ~0.044 (25% evolving,
      // deficit 0.074) meant all forced breaks went to coherent, creating a bipolar
      // exploring<->coherent cycle that excluded evolving. 0.12 allows breaks to evolving
      // when deficit is meaningful (target 0.32, actual 25% -> priority 0.131 > 0.12).
      const exploringRecoveryRegime = evolvingRecoveryPriority > 0.12 ? 'evolving' : 'coherent';
      forceRegimeTransition(exploringRecoveryRegime, 'exploring-max-dwell', exploringForcedWindow);
    }
    // R46: evolvingDeficit penalty 0.06->0.08 (stronger monopoly suppression when evolving underrepresented)
    const exploringMonopolyThreshold = clamp((shortFormPressure > 0 ? 0.66 : 0.72) - trustSharePressure * 0.04 - evolvingDeficit * 0.08 - phaseWeakness * 0.03 + phaseRecoveryCredit * 0.01 - (phaseStableRecoveryWindow ? 0.03 * phaseStableRecoveryStrength : 0), 0.54, 0.72);
    const exploringMonopolyMinDwellSec = shortFormPressure > 0
      ? m.max(config.EXPLORING_MONOPOLY_FLOOR_SEC, config.EXPLORING_MAX_DWELL_SEC * (0.45 - evolvingDeficit * 0.08))
      : m.max(config.EXPLORING_MONOPOLY_FLOOR_SEC, config.EXPLORING_MAX_DWELL_SEC * (0.50 - trustSharePressure * 0.06 - evolvingDeficit * 0.08 - phaseRecoveryCredit * 0.04 - (phaseStableRecoveryWindow ? 0.06 * phaseStableRecoveryStrength : 0)));
    if (state.forcedRegimeBeatsRemaining <= 0 && state.lastRegime === 'exploring' && runExploringShare > exploringMonopolyThreshold && exploringElapsedSec >= exploringMonopolyMinDwellSec) {
      forceRegimeTransition('evolving', 'exploring-share-monopoly', 4, state.exploringBeats, tickId);
    }

    // R68 E5 / R70 E2 / R72 E2: Evolving starvation injector.
    // R71 showed evolving re-collapsed to 2.5% in a 950-beat run despite
    // threshold raise to 0.04. Three improvements:
    // 1) Threshold raised 0.04->0.06 to keep injector active longer
    // 2) Window widened 3->5 beats for more impactful evolving blocks
    // 3) Now fires from coherent blocks too (not just exploring), since
    //    coherent dominated at 62% in R71 -- most beats never saw exploring
    // R74 E1: Lowered coherent threshold 20->15 beats. Evolving dropped
    // to 4.7% (from 7.9%) because coherent dominates at 55% and the
    // old 20-beat threshold rarely triggers. 15 beats allows more
    // frequent injection from shorter coherent runs.
    if (state.forcedRegimeBeatsRemaining <= 0
        && (state.lastRegime === 'exploring' || state.lastRegime === 'coherent')
        && evolvingShare < 0.06 && evolvingDeficit > 0.50
        && ((state.lastRegime === 'exploring' && exploringElapsedSec >= config.STARVATION_EXPLORING_SEC)
            || (state.lastRegime === 'coherent' && coherentElapsedSec >= config.STARVATION_COHERENT_SEC))) {
      // R76 E2: Exploring trigger 12->8 beats. Wider injection from
      // exploring since exploring surged to 52.9% in R75 but evolving
      // only gets forced injection, not organic classification.
      forceRegimeTransition('evolving', 'evolving-starvation-inject', 6,
        state.lastRegime === 'exploring' ? state.exploringBeats : state.coherentBeats, tickId);
    }

    let resolvedRegime = state.lastRegime;
    state.forcedOverrideActive = false;

    // R86 E2: Post-forced cooldown (time-based)
    const postForcedCooldownActive = beatStartTime < state.postForcedCooldownEndSec;

    if (state.forcedRegimeBeatsRemaining > 0) {
      resolvedRegime = state.forcedRegime;
      state.forcedOverrideActive = true;
      state.forcedOverrideBeats++;
      state.forcedRegimeBeatsRemaining--;
      state.rawRegimeWindow.length = 0;
      if (state.forcedRegimeBeatsRemaining === 0) {
        state.forcedRegime = '';
        state.postForcedCooldown = 8;
        state.postForcedCooldownEndSec = beatStartTime + config.POST_FORCED_COOLDOWN_SHORT_SEC;
      }
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
        : (rawRegime === 'evolving' && (evolvingRecoveryPriority > 0.42 || evolvingPolishPressure > 0.70) && (state.lastRegime === 'exploring' || state.lastRegime === 'coherent')
          ? 1
          : (rawRegime === 'evolving' && evolvingDeficit > 0.10 ? 2 : config.REGIME_MAJORITY));

      if (windowHits >= requiredHits) {
        let allowTransition = true;
        if (state.lastRegime === 'evolving' && evolvingElapsedSec > config.EVOLVING_MAX_DWELL_SEC) {
          allowTransition = true;
        } else if (state.lastRegime === 'evolving' && rawRegime === 'coherent' && evolvingElapsedSec < state.evolvingMinDwellSec) {
          allowTransition = false;
        } else if (state.lastRegime === 'evolving' && rawRegime === 'coherent') {
          const evolvingHoldFloorSec = evolvingRecoveryPriority > 0.40
            ? state.evolvingMinDwellSec + (phaseStableRecoveryWindow ? 2.5 + phaseStableRecoveryStrength * 0.83 : 1.7)
            : state.evolvingMinDwellSec;
          if (evolvingElapsedSec < evolvingHoldFloorSec) {
            allowTransition = false;
          }
        }

        if (allowTransition) {
          const organicCause = state.lastClassifyInputs.couplingStrength > state.lastClassifyInputs.coherentThreshold
            ? 'coupling-crossed-threshold' : 'velocity-shift';
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
          }, undefined, 'organic-' + organicCause);
          L0.post('regimeTransition', 'both', beatStartTime, { from: state.lastRegime, to: rawRegime, cause: 'organic-' + organicCause });
          if (state.lastRegime === 'coherent') {
            state.coherentMomentumBeats = m.max(config.COHERENT_MOMENTUM_WINDOW, m.floor(state.coherentBeats * 0.25));
            state.coherentMomentumEndSec = beatStartTime + m.max(config.COHERENT_MOMENTUM_SEC, coherentElapsedSec * 0.25);
          }
          state.rawRegimeWindow.length = 0;
          resolvedRegime = rawRegime;
        }
      }
    }

    // R86 E2: Post-forced cooldown enforcement. If the forced break just
    // ended (cooldown > 0) and the regime would return to coherent,
    // override to exploring. This prevents immediate coherent re-entry
    // that creates 44-break-44 superruns reducing transition variety.
    if (postForcedCooldownActive && resolvedRegime === 'coherent') {
      resolvedRegime = 'exploring';
    }

    if (state.forcedRegimeBeatsRemaining <= 0 && resolvedRegime === 'coherent') {
      // Fresh coherent entry: use 0 elapsed, not time-since-init (coherentStartSec inits to 0,
      // causing the dwell check to fire immediately if first coherent beat is after HARD_CAP_SEC).
      if (state.coherentBeats === 0) state.coherentStartSec = beatStartTime;
      const effectiveCoherentElapsedSec = beatStartTime - state.coherentStartSec;
      const projectedRunCoherentBeats = state.runLastResolvedRegime === 'coherent' ? state.runCoherentBeats + beatSpan : beatSpan;
      let coherentMaxDwellSec = config.COHERENT_MAX_DWELL_SEC;
      const lowPhaseThreshold = safePreBoot.call(() => phaseFloorController.getLowShareThreshold(), 0.03) || 0.03;
      if (phaseShare < lowPhaseThreshold) {
        const phaseCollapsePressure = clamp((lowPhaseThreshold - phaseShare) / m.max(lowPhaseThreshold, 0.01), 0, 1);
        coherentMaxDwellSec = m.max(config.COHERENT_FLOOR_HIGH_SEC, coherentMaxDwellSec * (1 - phaseCollapsePressure * 0.35));
      } else if (phaseShare > lowPhaseThreshold + 0.04) {
        // Phase healthy -- symmetric recovery: slightly extend coherent dwell to balance asymmetric suppression.
        const phaseHealthBonus = clamp((phaseShare - (lowPhaseThreshold + 0.04)) / 0.08, 0, 1);
        coherentMaxDwellSec = m.min(config.COHERENT_HARD_CAP_SEC, coherentMaxDwellSec * (1 + phaseHealthBonus * 0.12));
      }
      if (trustShare > 0.22) {
        const trustInflationPressure = clamp((trustShare - 0.22) / 0.08, 0, 1);
        coherentMaxDwellSec = m.max(config.COHERENT_FLOOR_HIGH_SEC, coherentMaxDwellSec * (1 - trustInflationPressure * 0.18));
      }
      if (evolvingRecoveryPriority > 0.30) {
        coherentMaxDwellSec = m.max(config.COHERENT_FLOOR_LOW_SEC, coherentMaxDwellSec * (1 - evolvingRecoveryPriority * 0.28));
      }
      if (evolvingPolishPressure > 0.35) {
        coherentMaxDwellSec = m.max(config.COHERENT_FLOOR_LOW_SEC, coherentMaxDwellSec * (1 - evolvingPolishPressure * 0.10));
      }
      if (evolvingShare < 0.03 && evolvingDeficit > 0.80) {
        const evolvingStarvationPressure = clamp((0.03 - evolvingShare) / 0.03, 0, 1);
        coherentMaxDwellSec = m.max(config.COHERENT_FLOOR_LOW_SEC, coherentMaxDwellSec * (1 - evolvingStarvationPressure * 0.20));
      }
      const coherentHighShare = state.runCoherentShare > 0.40;
      const evolvingStarved = evolvingShare < 0.05;
      if (coherentHighShare && evolvingStarved) {
        const coherentSharePressure = clamp((state.runCoherentShare - 0.40) / 0.20, 0, 1);
        coherentMaxDwellSec = m.max(config.COHERENT_FLOOR_LOW_SEC, coherentMaxDwellSec * (1 - coherentSharePressure * 0.25));
      }
      // Hard cap (was 37 beats, now time-based)
      coherentMaxDwellSec = m.min(coherentMaxDwellSec, config.COHERENT_HARD_CAP_SEC);
      if (effectiveCoherentElapsedSec > coherentMaxDwellSec) {
        const coherentOvershootSec = effectiveCoherentElapsedSec - coherentMaxDwellSec;
        const forcedWindow = clamp(12 + m.floor(coherentOvershootSec / 18) + m.floor(state.coherentShareEma * 6) + m.floor(evolvingRecoveryPriority * 3) + (phaseStableRecoveryWindow ? m.round(1 + phaseStableRecoveryStrength) : 0), 12, 24);
        const recoveryRegime = evolvingRecoveryPriority > 0.18 || evolvingPolishPressure > 0.65 || (evolvingShare < 0.03 && evolvingDeficit > 0.80) ? 'evolving' : 'exploring';
        forceRegimeTransition(recoveryRegime, 'coherent-max-dwell-run', forcedWindow, projectedRunCoherentBeats, tickId);
        resolvedRegime = recoveryRegime;
        state.forcedOverrideActive = true;
        state.forcedOverrideBeats++;
        state.forcedRegimeBeatsRemaining = m.max(0, state.forcedRegimeBeatsRemaining - 1);
        state.rawRegimeWindow.length = 0;
        if (state.forcedRegimeBeatsRemaining === 0) {
          state.forcedRegime = '';
          state.postForcedCooldown = 14;
          state.postForcedCooldownEndSec = beatStartTime + config.POST_FORCED_COOLDOWN_LONG_SEC;
        }
      }
    }

    let monopolyState = regimeClassifierHelpers.computeCadenceMonopolyProjection(state, resolvedRegime, beatSpan);
    if (state.forcedRegimeBeatsRemaining <= 0 && resolvedRegime === 'coherent' && monopolyState.active && (
      rawRegime === 'exploring' ||
      rawRegime === 'evolving' ||
      monopolyState.rawNonCoherentOpportunityShare > 0.16 ||
      monopolyState.opportunityGap > 0.10
    )) {
      const forcedWindow = clamp(6 + m.floor(monopolyState.pressure * 5) + m.floor(evolvingRecoveryPriority * 2) + (phaseStableRecoveryWindow ? 1 : 0), 6, 11);
      const recoveryRegime = evolvingRecoveryPriority > 0.30 || evolvingPolishPressure > 0.60 ? 'evolving' : monopolyState.preferredRegime;
      forceRegimeTransition(recoveryRegime, 'coherent-cadence-monopoly', forcedWindow, state.runCoherentBeats + beatSpan, tickId);
      resolvedRegime = recoveryRegime;
      state.forcedOverrideActive = true;
      state.forcedOverrideBeats++;
      state.forcedRegimeBeatsRemaining = m.max(0, state.forcedRegimeBeatsRemaining - 1);
      state.rawRegimeWindow.length = 0;
      if (state.forcedRegimeBeatsRemaining === 0) {
        state.forcedRegime = '';
        state.postForcedCooldown = 8;
        state.postForcedCooldownEndSec = beatStartTime + config.POST_FORCED_COOLDOWN_SHORT_SEC;
      }
      monopolyState = regimeClassifierHelpers.computeCadenceMonopolyProjection(state, resolvedRegime, beatSpan);
    }

    state.cadenceMonopolyPressure = monopolyState.pressure;
    state.cadenceMonopolyActive = monopolyState.active;
    state.cadenceMonopolyReason = monopolyState.reason;

    if (resolvedRegime === 'exploring') {
      if (state.exploringBeats === 0) state.exploringStartSec = beatStartTime;
      state.exploringBeats++;
      state.coherentBeats = 0;
      state.evolvingBeats = 0;
    } else if (resolvedRegime === 'coherent') {
      if (state.coherentBeats === 0) state.coherentStartSec = beatStartTime;
      state.coherentBeats++;
      state.exploringBeats = 0;
      state.evolvingBeats = 0;
    } else if (resolvedRegime === 'evolving') {
      if (state.evolvingBeats === 0) state.evolvingStartSec = beatStartTime;
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
