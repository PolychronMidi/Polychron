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
    const trustShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.trust === 'number'
      ? axisEnergy.shares.trust
      : 0;
    const runExploringShare = state.runBeatCount > 0
      ? ((state.runResolvedRegimeCounts.exploring || 0) / state.runBeatCount)
      : 0;
    const shortFormPressure = state.V.optionalFinite(totalSections, 0) > 0 && totalSections <= 4 ? 1 : 0;
    const evolvingShare = state.runBeatCount > 0
      ? ((state.runResolvedRegimeCounts.evolving || 0) / state.runBeatCount)
      : 0;
    const evolvingDeficit = clamp((config.REGIME_TARGET_EVOLVING_LO - evolvingShare) / config.REGIME_TARGET_EVOLVING_LO, 0, 1);
    const coherentOvershare = clamp((state.runCoherentShare - config.REGIME_TARGET_COHERENT_HI) / 0.18, 0, 1);
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
      const exploringWindowReduction = phaseShare > 0.08 && runExploringShare > 0.68 && trustSharePressure < 0.20 && evolvingDeficit < 0.20
        ? 0
        : m.floor(state.exploringBeats / 40) + m.floor((trustSharePressure + evolvingDeficit * 0.8 + phaseWeakness * 0.6) * 2);
      effectiveWindow = m.max(3, config.REGIME_WINDOW - exploringWindowReduction);
    }

    state.rawRegimeWindow.push(rawRegime);
    while (state.rawRegimeWindow.length > effectiveWindow) state.rawRegimeWindow.shift();

    if (state.forcedRegimeBeatsRemaining <= 0 && state.lastRegime === 'exploring' && state.exploringBeats >= config.EXPLORING_MAX_DWELL) {
      forceRegimeTransition('evolving', 'exploring-max-dwell', 3);
    }
    const exploringMonopolyThreshold = clamp((shortFormPressure > 0 ? 0.66 : 0.72) - trustSharePressure * 0.04 - evolvingDeficit * 0.06 - phaseWeakness * 0.03 + phaseRecoveryCredit * 0.01 - (phaseStableRecoveryWindow ? 0.03 * phaseStableRecoveryStrength : 0), 0.54, 0.72);
    const exploringMonopolyMinDwell = shortFormPressure > 0
      ? m.max(10, m.floor(config.EXPLORING_MAX_DWELL * (0.45 - evolvingDeficit * 0.08)))
      : m.max(10, m.floor(config.EXPLORING_MAX_DWELL * (0.50 - trustSharePressure * 0.06 - evolvingDeficit * 0.08 - phaseRecoveryCredit * 0.04 - (phaseStableRecoveryWindow ? 0.06 * phaseStableRecoveryStrength : 0))));
    if (state.forcedRegimeBeatsRemaining <= 0 && state.lastRegime === 'exploring' && runExploringShare > exploringMonopolyThreshold && state.exploringBeats >= exploringMonopolyMinDwell) {
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
        && ((state.lastRegime === 'exploring' && state.exploringBeats >= 8)
            || (state.lastRegime === 'coherent' && state.coherentBeats >= 15))) {
      // R76 E2: Exploring trigger 12->8 beats. Wider injection from
      // exploring since exploring surged to 52.9% in R75 but evolving
      // only gets forced injection, not organic classification.
      forceRegimeTransition('evolving', 'evolving-starvation-inject', 6,
        state.lastRegime === 'exploring' ? state.exploringBeats : state.coherentBeats, tickId);
    }

    let resolvedRegime = state.lastRegime;
    state.forcedOverrideActive = false;

    // R86 E2: Decrement post-forced cooldown and prevent coherent re-entry
    if (state.postForcedCooldown > 0) {
      state.postForcedCooldown--;
    }

    if (state.forcedRegimeBeatsRemaining > 0) {
      resolvedRegime = state.forcedRegime;
      state.forcedOverrideActive = true;
      state.forcedOverrideBeats++;
      state.forcedRegimeBeatsRemaining--;
      state.rawRegimeWindow.length = 0;
      if (state.forcedRegimeBeatsRemaining === 0) {
        state.forcedRegime = '';
        state.postForcedCooldown = 8;
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
        if (state.lastRegime === 'evolving' && state.evolvingBeats > config.EVOLVING_MAX_DWELL) {
          allowTransition = true;
        } else if (state.lastRegime === 'evolving' && rawRegime === 'coherent' && state.evolvingBeats < state.evolvingMinDwell) {
          allowTransition = false;
        } else if (state.lastRegime === 'evolving' && rawRegime === 'coherent') {
          const evolvingHoldFloor = evolvingRecoveryPriority > 0.40
            ? state.evolvingMinDwell + (phaseStableRecoveryWindow ? m.round(3 + phaseStableRecoveryStrength) : 2)
            : state.evolvingMinDwell;
          if (state.evolvingBeats < evolvingHoldFloor) {
            allowTransition = false;
          }
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

    // R86 E2: Post-forced cooldown enforcement. If the forced break just
    // ended (cooldown > 0) and the regime would return to coherent,
    // override to exploring. This prevents immediate coherent re-entry
    // that creates 44-break-44 superruns reducing transition variety.
    if (state.postForcedCooldown > 0 && resolvedRegime === 'coherent') {
      resolvedRegime = 'exploring';
    }

    if (state.forcedRegimeBeatsRemaining <= 0 && resolvedRegime === 'coherent') {
      const projectedRunCoherentBeats = state.runLastResolvedRegime === 'coherent' ? state.runCoherentBeats + beatSpan : beatSpan;
      let coherentMaxDwell = config.COHERENT_MAX_DWELL;
      const lowPhaseThreshold = safePreBoot.call(() => phaseFloorController.getLowShareThreshold(), 0.03) || 0.03;
      if (phaseShare < lowPhaseThreshold) {
        const phaseCollapsePressure = clamp((lowPhaseThreshold - phaseShare) / m.max(lowPhaseThreshold, 0.01), 0, 1);
        coherentMaxDwell = m.max(48, m.round(config.COHERENT_MAX_DWELL * (1 - phaseCollapsePressure * 0.35)));
      }
      if (trustShare > 0.22) {
        const trustInflationPressure = clamp((trustShare - 0.22) / 0.08, 0, 1);
        coherentMaxDwell = m.max(48, m.round(coherentMaxDwell * (1 - trustInflationPressure * 0.18)));
      }
      if (evolvingRecoveryPriority > 0.30) {
        coherentMaxDwell = m.max(36, m.round(coherentMaxDwell * (1 - evolvingRecoveryPriority * 0.28)));
      }
      if (evolvingPolishPressure > 0.35) {
        coherentMaxDwell = m.max(36, m.round(coherentMaxDwell * (1 - evolvingPolishPressure * 0.10)));
      }
      // R62 E2: Evolving deficit fallback -- when evolving is critically low
      // (< 3%), force shorter coherent runs to create evolving windows even
      // when phase is too low for normal evolvingRecoveryPriority.
      if (evolvingShare < 0.03 && evolvingDeficit > 0.80) {
        const evolvingStarvationPressure = clamp((0.03 - evolvingShare) / 0.03, 0, 1);
        coherentMaxDwell = m.max(36, m.round(coherentMaxDwell * (1 - evolvingStarvationPressure * 0.20)));
      }
      // R66 E4: Coherent-aware evolving injection. When coherent share is
      // already high (> 0.40) AND evolving is starved (< 0.05), shorten
      // coherent dwell further. The existing pathways create evolving windows
      // too infrequently -- this adds coherent-share pressure to the dwell.
      const coherentHighShare = state.runCoherentShare > 0.40;
      const evolvingStarved = evolvingShare < 0.05;
      if (coherentHighShare && evolvingStarved) {
        const coherentSharePressure = clamp((state.runCoherentShare - 0.40) / 0.20, 0, 1);
        coherentMaxDwell = m.max(36, m.round(coherentMaxDwell * (1 - coherentSharePressure * 0.25)));
      }
      // R69 E2 / R72 E5 / R75 E4: Hard absolute cap on consecutive coherent beats.
      // R74 still showed maxConsecutiveCoherent at 110 trace entries.
      // R82 E4: Reduced cap 50->44. R81 coherent share surged 51.7%->62.5%
      // and transition count dropped 52->36. Shorter coherent runs create
      // more regime transition opportunities and compositional variety.
      // R35 E2: Reduced cap 44->38. R34 coherent 46.4% (above 35% target).
      // R36 E3: Restore to 42. R35 exploring recovered (35.1%) but evolving
      // crashed (16.7%). 42 is a middle ground.
      // R38 E4: Dwell 42->40. Evolving dropped 26.7%->18.7% in R37 as
      // coherent rose back to 46.5%. Shorter dwell forces more transitions.
      // R40 E5: Dwell 40->38. Coherent surged to 47.6% in R39, with
      // maxConsecutiveCoherent=94 and evolving dropping to 17.7%.
      // R44 E3: Dwell 38->36. Coherent surged to 42.0% in R43.
      // R45 E2: Restore dwell 36->38. Evolving crashed to 22.0% in R44
      // while exploring surged to 42.6%. Forced transitions create
      // exploring (not evolving) when dwell is too short.
      // R47 E3: Lower dwell 38->35. Coherent surged to 46.9% in R46.
      // R49 E1: Partial restore 35->36. Dwell 35 created exploring surge
      // to 44.6% in R48. Moderate 36 balances coherent containment with
      // evolving recovery.
      coherentMaxDwell = m.min(coherentMaxDwell, 37);
      if (projectedRunCoherentBeats > coherentMaxDwell) {
        const coherentOvershoot = projectedRunCoherentBeats - coherentMaxDwell;
        // R84 E2: Expand forced window [5,15]->[8,20]. maxConsecutiveCoherent
        // was 102 in R83 despite cap=44. The [5,15] window was too short --
        // coherent re-established immediately after forced breaks, producing
        // back-to-back 44-beat coherent runs with only brief interruptions.
        // Wider forced window [8,20] makes breaks more impactful, giving the
        // non-coherent regime time to establish trajectory momentum.
        // R70 E1: Widen forced break floor 8->12. maxConsecutiveCoherent was 77
        // despite 37-beat dwell cap -- coherent re-establishes immediately after
        // short 8-beat breaks. Wider floor gives non-coherent regimes time to
        // build trajectory momentum before coherent can reclaim.
        const forcedWindow = clamp(12 + m.floor(coherentOvershoot / 22) + m.floor(state.coherentShareEma * 6) + m.floor(evolvingRecoveryPriority * 3) + (phaseStableRecoveryWindow ? m.round(1 + phaseStableRecoveryStrength) : 0), 12, 24);
        // R47 E4: Lower threshold 0.35->0.15. At R46's evolving=20.7% and
        // target=0.24, deficit=0.137, priority~0.14 -- never reaching 0.35.
        // Lower threshold ensures forced coherent breaks go to evolving.
        const recoveryRegime = evolvingRecoveryPriority > 0.18 || evolvingPolishPressure > 0.65 || (evolvingShare < 0.03 && evolvingDeficit > 0.80) ? 'evolving' : 'exploring';
        forceRegimeTransition(recoveryRegime, 'coherent-max-dwell-run', forcedWindow, projectedRunCoherentBeats, tickId);
        resolvedRegime = recoveryRegime;
        state.forcedOverrideActive = true;
        state.forcedOverrideBeats++;
        state.forcedRegimeBeatsRemaining = m.max(0, state.forcedRegimeBeatsRemaining - 1);
        state.rawRegimeWindow.length = 0;
        if (state.forcedRegimeBeatsRemaining === 0) {
          state.forcedRegime = '';
          // R70 E1: Extend cooldown 8->14. Prevents rapid coherent
          // re-entry after forced break, addressing maxConsecutiveCoherent=77.
          state.postForcedCooldown = 14;
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
      }
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
