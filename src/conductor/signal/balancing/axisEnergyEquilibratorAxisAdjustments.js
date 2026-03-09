axisEnergyEquilibratorAxisAdjustments = (() => {
  function _applyAxisLoop(state, config, context, V) {
    const entropyExploringDamp = context.regimeKey === 'exploring' ? 0.95 : 1.0;
    const phaseEvolvingDamp = context.regimeKey === 'evolving' ? 0.95 : 1.0;

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
        if (!isEmergencyStarved && !isPhaseCollapse && !isUndershootPartialBypass && (context.coherentColdspotFreeze || (axis === 'phase' && context.phaseSurfaceHot) || (axis === 'trust' && context.trustSurfaceHot))) {
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
        const emergencyBoost = isPhaseCollapse ? 4.0 : (isEmergencyStarved ? 3.0 : 1.0);
        const rate = config.AXIS_RELAX_RATE * pairScale * handOffRelaxBoost * nonNudgeableRelaxBoost * emergencyBoost * clamp(deficit / config.FAIR_SHARE, 0.5, 2.0);
        for (let p = 0; p < pairs.length; p++) {
          const pair = pairs[p];
          if ((state.pairCooldowns[pair] || 0) > 0) continue;
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

  function _applySpecialCaps(state, config, V) {
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
  }

  function apply(state, config, context, V) {
    _applyAxisLoop(state, config, context, V);
    _applySpecialCaps(state, config, V);
  }

  return { apply };
})();
