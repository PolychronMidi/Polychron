axisEnergyEquilibratorAxisAdjustments = (() => {
  function axisEnergyEquilibratorAxisAdjustmentsApplyAxisLoop(state, config, context, V) {
    const entropyExploringDamp = context.regimeKey === 'exploring' ? 0.95 : 1.0;
    const phaseEvolvingDamp = context.regimeKey === 'evolving' ? 0.95 : 1.0;

    for (let i = 0; i < config.ALL_AXES.length; i++) {
      const axis = config.ALL_AXES[i];
      const share = V.optionalFinite(state.smoothedShares[axis], 0);
      const pairs = config.axisToPairs[axis];
      const axisTightenScale = context.currentRegime === 'coherent'
        ? ((((axis === 'phase' || axis === 'density' || axis === 'flicker') && context.phaseSurfaceHot) ||
            ((axis === 'trust' || axis === 'density' || axis === 'tension' || axis === 'flicker') && context.trustSurfaceHot) ||
            ((axis === 'entropy' || axis === 'density' || axis === 'tension' || axis === 'flicker') && context.entropySurfaceHot))
          ? context.coherentHotspotScale
          : 0)
        : context.tightenScale;

      if (share > config.AXIS_OVERSHOOT && axisTightenScale > 0) {
        const excess = share - config.FAIR_SHARE;
        let dampMult = axis === 'entropy' ? entropyExploringDamp : 1.0;
        if (axis === 'phase') dampMult *= phaseEvolvingDamp;
        if (axis === 'entropy' && context.entropySurfaceHot) dampMult *= 1 + context.entropySurfacePressure * 0.35;
        // R9 E1: Inverted flicker dampMult direction. #4 manages signal RANGE,
        // not axis SHARE -- overshoot handler must apply stronger correction.
        // R11 E2: Strengthened slope 2.0->3.5, lowered threshold 0.20->0.18,
        // raised cap 0.25->0.40. At share=0.226: old=1.052, new=1.161.
        // Flicker rebounded to 0.226 in R10 because the 5% amplification
        // was insufficient. 16% amplification provides structural containment.
        if (axis === 'flicker' && share > 0.18) dampMult *= (1.0 + m.min(0.40, (share - 0.18) * 3.5));
        if (axis === 'density' && share > 0.25) dampMult -= 0.05;
        if (context.recoveryAxisHandOffPressure > 0 && context.densityFlickerAxisLock && (axis === 'density' || axis === 'flicker')) {
          dampMult *= 1 + context.recoveryAxisHandOffPressure * (0.40 + context.shortRunRecoveryBias * 0.35);
        }
        if (context.nonNudgeableTailPressure > 0 && context.nonNudgeableAxes.indexOf(axis) !== -1) {
          dampMult *= 1 + context.nonNudgeableTailPressure * 0.35;
        }

        const axisTotal = typeof context.axisTotals[axis] === 'number' && Number.isFinite(context.axisTotals[axis]) ? context.axisTotals[axis] : 0;
        if (context.axisTotalMedian > 0.01 && axisTotal > context.axisTotalMedian * 1.20) {
          const axisDominanceExcess = (axisTotal - context.axisTotalMedian) / context.axisTotalMedian;
          dampMult *= 1 + clamp(axisDominanceExcess * 0.50, 0, 0.50);
        }

        const tightenPairScale = config.RELAX_RATE_REF / (config.EFFECTIVE_NUDGEABLE[axis] || config.RELAX_RATE_REF);
        const rate = config.AXIS_TIGHTEN_RATE * tightenPairScale * axisTightenScale * context.giniMult * dampMult * clamp(excess / config.FAIR_SHARE, 0.5, 2.0);
        const crossWindow = config.CROSS_INHIBIT_WINDOW || 6;
        for (let p = 0; p < pairs.length; p++) {
          const pair = pairs[p];
          if ((V.optionalFinite(state.pairCooldowns[pair], 0)) > 0) continue;
          // Cross-inhibit: pair adjuster recently relaxed this pair -- don't immediately reverse
          if (state.pairLastRelaxBeat[pair] !== undefined && state.beatCount - state.pairLastRelaxBeat[pair] < crossWindow) continue;
          const baseline = V.optionalFinite(state.lastBaselines[pair]);
          if (baseline === undefined) continue;
          const nextBaseline = m.max(pair === 'density-flicker' ? config.DENSITY_FLICKER_BASELINE_MIN : config.BASELINE_MIN, baseline - rate);
          if (nextBaseline < baseline) {
            pipelineCouplingManager.setPairBaseline(pair, nextBaseline);
            state.pairCooldowns[pair] = config.AXIS_COOLDOWN;
            state.pairLastTightenBeat[pair] = state.beatCount;
            state.axisAdjustments++;
            if (context.currentRegime === 'coherent' && axisTightenScale > 0) state.coherentHotspotAxisAdj++;
            state.perAxisAdj[axis] = (V.optionalFinite(state.perAxisAdj[axis], 0)) + 1;
            state.regimeAxisAdj[context.regimeKey] = V.optionalFinite(state.regimeAxisAdj[context.regimeKey], 0) + 1;
          }
        }
      } else if (share < config.AXIS_UNDERSHOOT && share > 0.001) {
        const isEmergencyStarved = share < 0.08;
        const isPhaseCollapse = axis === 'phase' && share < 0.02;
        const isUndershootPartialBypass = !isEmergencyStarved && share < config.AXIS_UNDERSHOOT && (state.beatCount % 2 === 0);
        // R82 E3 + R83 E3: Graduated coherentFreeze coldspot bypass.
        // R83 E3: Widened threshold 0.12->0.18 and removed duty-cycle
        // constraint (was even-beat-only). R82's 50% duty cycle at
        // 0.08-0.12 was too narrow -- phase collapsed to 0.51%.
        const isCoherentFreezePartialBypass = !isEmergencyStarved && share < 0.18 && context.coherentColdspotFreeze;
        // R7 E4: Phase coherent-freeze bypass. When phase share < 0.10 during
        // coherent freeze, allow coldspot relaxation to prevent phase collapse.
        // R6 saw 47 skipped relaxations (45 coherent-freeze), phase 16.1%->4.6%.
        const isPhaseLowShareCoherentBypass = axis === 'phase' && share < 0.12 && context.coherentColdspotFreeze;
        // R83 E2 + R97 E1: Phase collapse detection with adaptive thresholds
        // from phaseFloorController (#14). Thresholds self-calibrate based on
        // rolling phase volatility and coherent regime duration.
        if (axis === 'phase') {
          const collapseThreshold = phaseFloorController.getCollapseThreshold();
          const lowShareThreshold = phaseFloorController.getLowShareThreshold();
          if (share < collapseThreshold) { state.phaseCollapseStreak++; }
          else { state.phaseCollapseStreak = 0; }
          if (share < lowShareThreshold) { state.phaseLowShareStreak++; }
          else { state.phaseLowShareStreak = 0; }
        }
        const isPhaseEmergencyBypass = axis === 'phase' && state.phaseCollapseStreak > 8;
        // R86-R89 + R97 E1: Phase axis energy floor via phaseFloorController.
        // Adaptive thresholds replace hardcoded 12/8 streak counts.
        const isPhaseFloorActive = axis === 'phase' && phaseFloorController.isFloorActive(state.phaseLowShareStreak);
        const isPhaseExtremeCollapse = axis === 'phase' && phaseFloorController.isExtremeCollapse(share, state.phaseLowShareStreak);
        // R61 E1: Override phaseHot skip when phase share is critically low.
        // Phase surface ratio can flag "hot" from p95/baseline inflation even at
        // 0.6% share. When phase < 0.04, the "hot" classification is an artifact
        // of low baselines, not real energy -- allow coldspot relaxation.
        const isPhaseHotOverride = axis === 'phase' && share < 0.04;
        if (!isEmergencyStarved && !isPhaseCollapse && !isUndershootPartialBypass && !isCoherentFreezePartialBypass && !isPhaseEmergencyBypass && !isPhaseFloorActive && !isPhaseExtremeCollapse && !isPhaseLowShareCoherentBypass && !isPhaseHotOverride && (context.coherentColdspotFreeze || (axis === 'phase' && context.phaseSurfaceHot) || (axis === 'trust' && context.trustSurfaceHot))) {
          state.skippedColdspotRelaxations++;
          if (context.coherentColdspotFreeze) state.coldspotSkipReasons.coherentFreeze++;
          else if (axis === 'phase' && context.phaseSurfaceHot) state.coldspotSkipReasons.phaseHot++;
          else if (axis === 'trust' && context.trustSurfaceHot) state.coldspotSkipReasons.trustHot++;
          continue;
        }
        const deficit = config.FAIR_SHARE - share;
        const pairScale = config.RELAX_RATE_REF / (config.EFFECTIVE_NUDGEABLE[axis] || config.RELAX_RATE_REF);
        const handOffRelaxBoost = context.recoveryAxisHandOffPressure > 0 && context.densityFlickerAxisLock && axis !== 'density' && axis !== 'flicker'
          ? 1 + context.recoveryAxisHandOffPressure * (0.55 + context.shortRunRecoveryBias * 0.40)
          : 1.0;
        const nonNudgeableRelaxBoost = context.nonNudgeableTailPressure > 0 && context.nonNudgeableAxes.indexOf(axis) !== -1
          ? 1 + context.nonNudgeableTailPressure * 0.30
          : 1.0;
        // R84 E2 + R97 E1: Phase boost multipliers via phaseFloorController (#14).
        // Continuous graduated formula replaces hardcoded 4.0/6.0/8.0/12.0/20.0
        // step-function. Self-calibrates based on deficit severity, coherent
        // regime duration, and recovery success history.
        const phaseBoosts = axis === 'phase'
          ? phaseFloorController.computeBoosts(share, state.phaseLowShareStreak, state.phaseCollapseStreak)
          : { phaseCollapseBoost: 4.0, phaseFloorBoost: 1.0, phaseRetractionMult: 1.0 };
        const emergencyBoost = isPhaseCollapse ? phaseBoosts.phaseCollapseBoost
          : (isEmergencyStarved ? 3.0
          : m.max(1.0, phaseBoosts.phaseFloorBoost * (phaseBoosts.phaseRetractionMult ?? 1.0)));
        if (axis === 'phase') phaseFloorController.recordBoostApplied(emergencyBoost);
        // R5 E2: Symmetric giniMult in undershoot handler. Previously only
        // the overshoot handler used giniMult -- suppressed axes didn't recover
        // faster when the system was imbalanced. This made axis starvation
        // self-reinforcing: dominant axes got tightened faster but starved axes
        // relaxed at a fixed slow rate regardless of Gini.
        const rate = config.AXIS_RELAX_RATE * pairScale * handOffRelaxBoost * nonNudgeableRelaxBoost * emergencyBoost * context.giniMult * clamp(deficit / config.FAIR_SHARE, 0.5, 2.0);
        const crossWindowR = config.CROSS_INHIBIT_WINDOW || 6;
        for (let p = 0; p < pairs.length; p++) {
          const pair = pairs[p];
          // R86 E1: Bypass pair cooldowns when phase floor/extreme collapse is active
          if (!isPhaseFloorActive && !isPhaseExtremeCollapse && (V.optionalFinite(state.pairCooldowns[pair], 0)) > 0) continue;
          // Cross-inhibit: pair adjuster recently tightened this pair -- don't immediately reverse
          if (!isPhaseFloorActive && !isPhaseExtremeCollapse &&
              state.pairLastTightenBeat[pair] !== undefined && state.beatCount - state.pairLastTightenBeat[pair] < crossWindowR) continue;
          const baseline = V.optionalFinite(state.lastBaselines[pair]);
          if (baseline === undefined) continue;
          const nextBaseline = m.min(config.BASELINE_MAX, baseline + rate);
          if (nextBaseline > baseline) {
            pipelineCouplingManager.setPairBaseline(pair, nextBaseline);
            state.pairCooldowns[pair] = config.AXIS_COOLDOWN;
            state.pairLastRelaxBeat[pair] = state.beatCount;
            state.axisAdjustments++;
            state.perAxisAdj[axis] = (V.optionalFinite(state.perAxisAdj[axis], 0)) + 1;
            state.regimeAxisAdj[context.regimeKey] = V.optionalFinite(state.regimeAxisAdj[context.regimeKey], 0) + 1;
          }
        }
      }
    }
  }

  function axisEnergyEquilibratorAxisAdjustmentsApplySpecialCaps(state, config, V) {
    const tensionSmoothed = state.smoothedShares.tension;
    if (typeof tensionSmoothed === 'number' && tensionSmoothed < 0.15 && tensionSmoothed > 0.001) {
      state.perLegacyOverrideEntries['tension-floor-0.15']++;
      const tensionDeficit = 0.15 - tensionSmoothed;
      const tensionPairScale = config.RELAX_RATE_REF / (config.EFFECTIVE_NUDGEABLE.tension || config.RELAX_RATE_REF);
      const tensionFloorRate = m.min(0.03, config.AXIS_RELAX_RATE * 2.5 * tensionPairScale * clamp(tensionDeficit / config.FAIR_SHARE, 0.5, 2.0));
      const tensionPairs = V.assertArray(config.axisToPairs.tension, "config.axisToPairs.tension");
      for (let i = 0; i < tensionPairs.length; i++) {
        const pair = tensionPairs[i];
        if ((V.optionalFinite(state.pairCooldowns[pair], 0)) > 0) continue;
        const baseline = V.optionalFinite(state.lastBaselines[pair]);
        if (baseline === undefined) continue;
        const nextBaseline = m.min(config.BASELINE_MAX, baseline + tensionFloorRate);
        if (nextBaseline > baseline) {
          pipelineCouplingManager.setPairBaseline(pair, nextBaseline);
          state.pairCooldowns[pair] = config.AXIS_COOLDOWN;
          state.axisAdjustments++;
          state.perAxisAdj.tension = (V.optionalFinite(state.perAxisAdj.tension, 0)) + 1;
          state.perLegacyOverride['tension-floor-0.15']++;
        }
      }
    }

    // R13: Removed entropy-cap-0.19 legacy override. Instrumentation over
    // multiple rounds showed 0 fires AND 0 entries: entropy stayed below 0.19
    // under current composition, so the cap never activated. The generic
    // AXIS_OVERSHOOT handler at 0.22 covers the rare case if entropy ever
    // spikes above that threshold.

    // R5 E5: Removed R4 E3 manual entropy floor at 0.13. This was a
    // whack-a-mole constant that duplicated the generic AXIS_UNDERSHOOT
    // handler (which already fires at < 0.12) and conflicted with the
    // hypermeta equilibrator's adaptive rebalancing. With R5 E1-E2
    // (progressive giniMult + symmetric undershoot recovery), the generic
    // handler should recover entropy without manual overrides.

    // R15: Removed phase-trust-seesaw (+ graduated 0.02/0.04 sub-thresholds).
    // Instrumentation across R11-R14 showed 0 fires AND 0 entries for 5
    // consecutive rounds: phase never dropped below 0.08 under current
    // composition, so the seesaw never activated. phaseFloorController (#14)
    // handles phase recovery directly; trustStarvationAutoNourishment (#5)
    // handles trust recovery. Both operate without needing the seesaw's
    // coordinated cap. If phase collapse ever returns, investigate WHY
    // phaseFloorController is insufficient rather than re-adding this.

    // R6 E5 + R7 E2: Trust-axis share floor enforcement. When trust share drops
    // below 0.14, apply gentle bias to trust-pair baselines. R7: reduced from
    // 1.05x to 0.50x -- R6's 1.05x over-corrected (trust 12.2%->19.4%, phase displaced).
    if (typeof trustSmoothed === 'number' && trustSmoothed < 0.14 && trustSmoothed > 0.001) {
      state.perLegacyOverrideEntries['trust-floor-0.14']++;
      const trustDeficit = 0.14 - trustSmoothed;
      const trustFloorPairScale = config.RELAX_RATE_REF / (config.EFFECTIVE_NUDGEABLE.trust || config.RELAX_RATE_REF);
      // R3 E2: Trust floor rate 0.50 -> 1.2. Trust recovery was 5x slower
      // than tension (0.50 vs 2.5). 1.2 gives trust meaningful recovery speed
      // without overshooting phase (which is the reason R7 reduced from 1.05).
      const trustFloorRate = m.min(0.03, config.AXIS_RELAX_RATE * 1.20 * trustFloorPairScale * clamp(trustDeficit / config.FAIR_SHARE, 0.5, 2.0));
      const trustFloorPairs = V.assertArray(config.axisToPairs.trust, "config.axisToPairs.trust");
      for (let i = 0; i < trustFloorPairs.length; i++) {
        const pair = trustFloorPairs[i];
        // R8 E2: Skip non-nudgeable pairs (entropy-trust, trust-phase). These
        // have zero gain so baseline changes have no effect, yet they consumed
        // 2/5 of the trust floor adjustment budget. Concentrating relaxation
        // on the 3 active pairs (density-trust, tension-trust, flicker-trust)
        // makes trust recovery corrections effective.
        if (config.NON_NUDGEABLE_TAIL_SET && config.NON_NUDGEABLE_TAIL_SET.has(pair)) continue;
        if ((V.optionalFinite(state.pairCooldowns[pair], 0)) > 0) continue;
        const baseline = V.optionalFinite(state.lastBaselines[pair]);
        if (baseline === undefined) continue;
        const nextBaseline = m.min(config.BASELINE_MAX, baseline + trustFloorRate);
        if (nextBaseline > baseline) {
          pipelineCouplingManager.setPairBaseline(pair, nextBaseline);
          state.pairCooldowns[pair] = config.AXIS_COOLDOWN;
          state.axisAdjustments++;
          state.perAxisAdj.trust = (V.optionalFinite(state.perAxisAdj.trust, 0)) + 1;
          state.perLegacyOverride['trust-floor-0.14']++;
        }
      }
    }
  }

  function apply(state, config, context, V) {
    axisEnergyEquilibratorAxisAdjustmentsApplyAxisLoop(state, config, context, V);
    axisEnergyEquilibratorAxisAdjustmentsApplySpecialCaps(state, config, V);
  }

  return { apply };
})();
