moduleLifecycle.declare({
  name: 'axisEnergyEquilibratorRefreshContext',
  subsystem: 'conductor',
  deps: [],
  provides: ['axisEnergyEquilibratorRefreshContext'],
  init: (deps) => {
  function build(state, config, V) {
    state.beatCount++;

    const cooldownKeys = Object.keys(state.pairCooldowns);
    for (let i = 0; i < cooldownKeys.length; i++) {
      if (state.pairCooldowns[cooldownKeys[i]] > 0) state.pairCooldowns[cooldownKeys[i]]--;
    }

    const energyData = pipelineCouplingManager.getAxisEnergyShare();
    if (!energyData || !energyData.shares) return null;
    const shares = energyData.shares;
    const axisGini = V.optionalFinite(energyData.axisGini, 0);

    for (let i = 0; i < config.ALL_AXES.length; i++) {
      const axis = config.ALL_AXES[i];
      const raw = V.optionalFinite(shares[axis], 0);
      if (state.smoothedShares[axis] === undefined) state.smoothedShares[axis] = raw;
      else state.smoothedShares[axis] += (raw - state.smoothedShares[axis]) * config.SHARE_EMA_ALPHA;
    }

    state.lastWarmupTicks = axisEnergyEquilibratorHelpers.getWarmupTicks(config.WARMUP_DEFAULT);
    if (state.beatCount < state.lastWarmupTicks) return null;

    // R5 E1: Progressive giniMult. Continuous ramp replacing dead binary threshold.
    // R7 E2: Steeper ramp (0.06/0.20 vs 0.08/0.25). Engages earlier and
    // ramps faster to combat Gini regression (0.0906->0.112 in R6).
    // R18 E1: Strengthened from 0.06/0.20/0.7 to 0.04/0.16/0.95. Density
    // share surged to 0.213 (+31%) in R17 while entropy dropped to 0.123.
    // Stronger giniMult makes axis equilibration ~2x faster at Gini 0.10,
    // tightening dominant axes and relaxing suppressed ones more aggressively.
    // At Gini 0.10: old 1.14, new 1.36. At Gini 0.15: old 1.31, new 1.65.
    const giniMult = 1.0 + clamp((axisGini - 0.04) / 0.16, 0, 1) * 0.95;
    const homeostasisState = couplingHomeostasis.getState();
    const recoveryAxisHandOffPressure = V.optionalFinite(homeostasisState && homeostasisState.recoveryAxisHandOffPressure, 0);
    const shortRunRecoveryBias = V.optionalFinite(homeostasisState && homeostasisState.shortRunRecoveryBias, 0);
    const nonNudgeableTailPressure = V.optionalFinite(homeostasisState && homeostasisState.nonNudgeableTailPressure, 0);
    const nonNudgeableTailPair = homeostasisState && typeof homeostasisState.nonNudgeableTailPair === 'string'
      ? homeostasisState.nonNudgeableTailPair
      : '';
    const recoveryDominantAxes = homeostasisState && Array.isArray(homeostasisState.recoveryDominantAxes)
      ? homeostasisState.recoveryDominantAxes
      : [];
    const nonNudgeableAxes = nonNudgeableTailPair && nonNudgeableTailPair.indexOf('-') !== -1
      ? nonNudgeableTailPair.split('-')
      : recoveryDominantAxes;
    const densityFlickerAxisLock = recoveryDominantAxes.indexOf('density') !== -1 && recoveryDominantAxes.indexOf('flicker') !== -1;

    state.lastBaselines = pipelineCouplingManager.getPairBaselines();
    const snapshot = pipelineCouplingManager.getAdaptiveTargetSnapshot();
    const phaseSurface = axisEnergyEquilibratorHelpers.computeSurfacePressure(
      snapshot,
      ['density-phase', 'flicker-phase', 'tension-phase'],
      config.PHASE_SURFACE_RATIO,
      config.PHASE_SURFACE_ABS_MIN,
      0.18,
      0.03
    );
    const trustSurface = axisEnergyEquilibratorHelpers.computeSurfacePressure(
      snapshot,
      ['density-trust', 'flicker-trust', 'tension-trust'],
      config.TRUST_SURFACE_RATIO,
      config.TRUST_SURFACE_ABS_MIN,
      0.16,
      0.03
    );
    const entropySurface = axisEnergyEquilibratorHelpers.computeSurfacePressure(
      snapshot,
      ['density-entropy', 'tension-entropy', 'flicker-entropy', 'entropy-trust', 'entropy-phase'],
      config.ENTROPY_SURFACE_RATIO,
      config.ENTROPY_SURFACE_ABS_MIN,
      0.16,
      0.04
    );
    if (phaseSurface.surfaceHot) state.phaseSurfaceHotBeats++;
    if (trustSurface.surfaceHot) state.trustSurfaceHotBeats++;
    if (entropySurface.surfaceHot) state.entropySurfaceHotBeats++;

    const currentRegime = regimeClassifier.getRegime();
    const coherentHotspotScale = currentRegime === 'coherent' && (phaseSurface.surfaceHot || trustSurface.surfaceHot)
      ? clamp(
        config.COHERENT_HOTSPOT_MIN_SCALE +
        phaseSurface.surfacePressure * 0.14 +
        trustSurface.surfacePressure * 0.12 +
        entropySurface.surfacePressure * 0.10,
        config.COHERENT_HOTSPOT_MIN_SCALE,
        config.COHERENT_HOTSPOT_MAX_SCALE
      )
      : 0;
    if (coherentHotspotScale > 0) state.coherentHotspotActuationBeats++;

    const tightenScale = currentRegime === 'coherent'
      ? 0.0
      : currentRegime === 'evolving'
        ? 0.6
        : currentRegime === 'exploring'
          ? 1.5
          : 1.0;
    const coherentColdspotFreeze = currentRegime === 'coherent' && (phaseSurface.surfaceHot || trustSurface.surfaceHot || entropySurface.surfaceHot);
    if (coherentColdspotFreeze) state.coherentFreezeBeats++;

    const regimeKey = currentRegime || 'unknown';
    state.regimeBeats[regimeKey] = (state.regimeBeats[regimeKey] ?? 0) + 1;
    state.regimeTightenBudget[regimeKey] = (state.regimeTightenBudget[regimeKey] ?? 0) + tightenScale;

    const axisTotals = pipelineCouplingManager.getAxisCouplingTotals();
    const axisTotalValues = [];
    for (let i = 0; i < config.ALL_AXES.length; i++) {
      const axisValue = axisTotals[config.ALL_AXES[i]];
      if (typeof axisValue === 'number' && Number.isFinite(axisValue)) axisTotalValues.push(axisValue);
    }
    axisTotalValues.sort(function(a, b) { return a - b; });
    const axisTotalMedian = axisTotalValues.length > 0
      ? axisTotalValues[m.floor(axisTotalValues.length / 2)]
      : 0;

    return {
      axisGini,
      giniMult,
      shares,
      snapshot,
      currentRegime,
      regimeKey,
      tightenScale,
      coherentColdspotFreeze,
      coherentHotspotScale,
      recoveryAxisHandOffPressure,
      shortRunRecoveryBias,
      nonNudgeableTailPressure,
      nonNudgeableAxes,
      densityFlickerAxisLock,
      phaseSurfaceHot: phaseSurface.surfaceHot,
      phaseSurfacePressure: phaseSurface.surfacePressure,
      trustSurfaceHot: trustSurface.surfaceHot,
      trustSurfacePressure: trustSurface.surfacePressure,
      entropySurfaceHot: entropySurface.surfaceHot,
      entropySurfacePressure: entropySurface.surfacePressure,
      axisTotals,
      axisTotalMedian
    };
  }

  return { build };
  },
});
