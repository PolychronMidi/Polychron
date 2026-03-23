axisEnergyEquilibratorAxisAdjustments = (() => {
  function axisEnergyEquilibratorAxisAdjustmentsApplyAxisLoop(state, config, context, V) {
    const entropyExploringDamp = context.regimeKey === 'exploring' ? 0.95 : 1.0;
    const phaseEvolvingDamp = context.regimeKey === 'evolving' ? 0.95 : 1.0;
    // R34 E2: Phase relaxation boost under exploring regime to prevent phase starvation
    // Exploring-heavy runs (77.8% under explosive) starve phase; this gives 1.3x relaxation rate
    const phaseExploringRelaxBoost = context.regimeKey === 'exploring' ? 1.3 : 1.0;

    for (let i = 0; i < config.ALL_AXES.length; i++) {
      const axis = config.ALL_AXES[i];
      const share = state.smoothedShares[axis] || 0;
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
        if (axis === 'flicker' && share > 0.20) dampMult *= (1.0 - m.min(0.15, (share - 0.20) * 1.5));
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
        for (let p = 0; p < pairs.length; p++) {
          const pair = pairs[p];
          if ((state.pairCooldowns[pair] || 0) > 0) continue;
          const baseline = V.optionalFinite(state.lastBaselines[pair]);
          if (baseline === undefined) continue;
          const nextBaseline = m.max(pair === 'density-flicker' ? config.DENSITY_FLICKER_BASELINE_MIN : config.BASELINE_MIN, baseline - rate);
          if (nextBaseline < baseline) {
            pipelineCouplingManager.setPairBaseline(pair, nextBaseline);
            state.pairCooldowns[pair] = config.AXIS_COOLDOWN;
            state.axisAdjustments++;
            if (context.currentRegime === 'coherent' && axisTightenScale > 0) state.coherentHotspotAxisAdj++;
            state.perAxisAdj[axis] = (state.perAxisAdj[axis] || 0) + 1;
            state.regimeAxisAdj[context.regimeKey] = (state.regimeAxisAdj[context.regimeKey] || 0) + 1;
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
        const isPhaseLowShareCoherentBypass = axis === 'phase' && share < 0.10 && context.coherentColdspotFreeze;
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
        if (!isEmergencyStarved && !isPhaseCollapse && !isUndershootPartialBypass && !isCoherentFreezePartialBypass && !isPhaseEmergencyBypass && !isPhaseFloorActive && !isPhaseExtremeCollapse && !isPhaseLowShareCoherentBypass && (context.coherentColdspotFreeze || (axis === 'phase' && context.phaseSurfaceHot) || (axis === 'trust' && context.trustSurfaceHot))) {
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
          : { phaseCollapseBoost: 4.0, phaseFloorBoost: 1.0 };
        const emergencyBoost = isPhaseCollapse ? phaseBoosts.phaseCollapseBoost : (isEmergencyStarved ? 3.0 : m.max(1.0, phaseBoosts.phaseFloorBoost));
        if (axis === 'phase') phaseFloorController.recordBoostApplied(emergencyBoost);
        const rate = config.AXIS_RELAX_RATE * pairScale * handOffRelaxBoost * nonNudgeableRelaxBoost * emergencyBoost * (axis === 'phase' ? phaseExploringRelaxBoost : 1.0) * clamp(deficit / config.FAIR_SHARE, 0.5, 2.0);
        for (let p = 0; p < pairs.length; p++) {
          const pair = pairs[p];
          // R86 E1: Bypass pair cooldowns when phase floor/extreme collapse is active
          if (!isPhaseFloorActive && !isPhaseExtremeCollapse && (state.pairCooldowns[pair] || 0) > 0) continue;
          const baseline = V.optionalFinite(state.lastBaselines[pair]);
          if (baseline === undefined) continue;
          const nextBaseline = m.min(config.BASELINE_MAX, baseline + rate);
          if (nextBaseline > baseline) {
            pipelineCouplingManager.setPairBaseline(pair, nextBaseline);
            state.pairCooldowns[pair] = config.AXIS_COOLDOWN;
            state.axisAdjustments++;
            state.perAxisAdj[axis] = (state.perAxisAdj[axis] || 0) + 1;
            state.regimeAxisAdj[context.regimeKey] = (state.regimeAxisAdj[context.regimeKey] || 0) + 1;
          }
        }
      }
    }
  }

  function axisEnergyEquilibratorAxisAdjustmentsApplySpecialCaps(state, config, V) {
    const tensionSmoothed = state.smoothedShares.tension;
    if (typeof tensionSmoothed === 'number' && tensionSmoothed < 0.15 && tensionSmoothed > 0.001) {
      const tensionDeficit = 0.15 - tensionSmoothed;
      const tensionPairScale = config.RELAX_RATE_REF / (config.EFFECTIVE_NUDGEABLE.tension || config.RELAX_RATE_REF);
      const tensionFloorRate = m.min(0.03, config.AXIS_RELAX_RATE * 2.5 * tensionPairScale * clamp(tensionDeficit / config.FAIR_SHARE, 0.5, 2.0));
      const tensionPairs = config.axisToPairs.tension || [];
      for (let i = 0; i < tensionPairs.length; i++) {
        const pair = tensionPairs[i];
        if ((state.pairCooldowns[pair] || 0) > 0) continue;
        const baseline = V.optionalFinite(state.lastBaselines[pair]);
        if (baseline === undefined) continue;
        const nextBaseline = m.min(config.BASELINE_MAX, baseline + tensionFloorRate);
        if (nextBaseline > baseline) {
          pipelineCouplingManager.setPairBaseline(pair, nextBaseline);
          state.pairCooldowns[pair] = config.AXIS_COOLDOWN;
          state.axisAdjustments++;
          state.perAxisAdj.tension = (state.perAxisAdj.tension || 0) + 1;
        }
      }
    }

    const entropySmoothed = state.smoothedShares.entropy;
    if (typeof entropySmoothed === 'number' && entropySmoothed > 0.19) {
      const entropyExcess = entropySmoothed - 0.19;
      const entropyPairScale = config.RELAX_RATE_REF / (config.EFFECTIVE_NUDGEABLE.entropy || config.RELAX_RATE_REF);
      const entropyCapRate = m.min(0.03, config.AXIS_TIGHTEN_RATE * 2.5 * entropyPairScale * clamp(entropyExcess / config.FAIR_SHARE, 0.5, 2.0));
      const entropyPairs = config.axisToPairs.entropy || [];
      for (let i = 0; i < entropyPairs.length; i++) {
        const pair = entropyPairs[i];
        if ((state.pairCooldowns[pair] || 0) > 0) continue;
        const baseline = V.optionalFinite(state.lastBaselines[pair]);
        if (baseline === undefined) continue;
        const nextBaseline = m.max(pair === 'density-flicker' ? config.DENSITY_FLICKER_BASELINE_MIN : config.BASELINE_MIN, baseline - entropyCapRate);
        if (nextBaseline < baseline) {
          pipelineCouplingManager.setPairBaseline(pair, nextBaseline);
          state.pairCooldowns[pair] = config.AXIS_COOLDOWN;
          state.axisAdjustments++;
          state.perAxisAdj.entropy = (state.perAxisAdj.entropy || 0) + 1;
        }
      }
    }

    const phaseSmoothed = state.smoothedShares.phase;
    const trustSmoothed = state.smoothedShares.trust;
    if (typeof phaseSmoothed === 'number' && phaseSmoothed < 0.01 && typeof trustSmoothed === 'number' && trustSmoothed > config.FAIR_SHARE * 1.3) {
      const trustExcess = trustSmoothed - config.FAIR_SHARE * 1.3;
      const trustPairScale = config.RELAX_RATE_REF / (config.EFFECTIVE_NUDGEABLE.trust || config.RELAX_RATE_REF);
      const trustCapRate = m.min(0.03, config.AXIS_TIGHTEN_RATE * 2.0 * trustPairScale * clamp(trustExcess / config.FAIR_SHARE, 0.5, 2.0));
      const trustPairs = config.axisToPairs.trust || [];
      for (let i = 0; i < trustPairs.length; i++) {
        const pair = trustPairs[i];
        if ((state.pairCooldowns[pair] || 0) > 0) continue;
        const baseline = V.optionalFinite(state.lastBaselines[pair]);
        if (baseline === undefined) continue;
        const nextBaseline = m.max(pair === 'density-flicker' ? config.DENSITY_FLICKER_BASELINE_MIN : config.BASELINE_MIN, baseline - trustCapRate);
        if (nextBaseline < baseline) {
          pipelineCouplingManager.setPairBaseline(pair, nextBaseline);
          state.pairCooldowns[pair] = config.AXIS_COOLDOWN;
          state.axisAdjustments++;
          state.perAxisAdj.trust = (state.perAxisAdj.trust || 0) + 1;
        }
      }
    }

    // R6 E5 + R7 E2: Trust-axis share floor enforcement. When trust share drops
    // below 0.14, apply gentle bias to trust-pair baselines. R7: reduced from
    // 1.05x to 0.50x -- R6's 1.05x over-corrected (trust 12.2%->19.4%, phase displaced).
    if (typeof trustSmoothed === 'number' && trustSmoothed < 0.14 && trustSmoothed > 0.001) {
      const trustDeficit = 0.14 - trustSmoothed;
      const trustFloorPairScale = config.RELAX_RATE_REF / (config.EFFECTIVE_NUDGEABLE.trust || config.RELAX_RATE_REF);
      const trustFloorRate = m.min(0.03, config.AXIS_RELAX_RATE * 0.50 * trustFloorPairScale * clamp(trustDeficit / config.FAIR_SHARE, 0.5, 2.0));
      const trustFloorPairs = config.axisToPairs.trust || [];
      for (let i = 0; i < trustFloorPairs.length; i++) {
        const pair = trustFloorPairs[i];
        if ((state.pairCooldowns[pair] || 0) > 0) continue;
        const baseline = V.optionalFinite(state.lastBaselines[pair]);
        if (baseline === undefined) continue;
        const nextBaseline = m.min(config.BASELINE_MAX, baseline + trustFloorRate);
        if (nextBaseline > baseline) {
          pipelineCouplingManager.setPairBaseline(pair, nextBaseline);
          state.pairCooldowns[pair] = config.AXIS_COOLDOWN;
          state.axisAdjustments++;
          state.perAxisAdj.trust = (state.perAxisAdj.trust || 0) + 1;
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
