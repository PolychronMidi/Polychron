// axisEnergyEquilibrator.js - Hypermeta controller facade for coupling-energy redistribution.

axisEnergyEquilibrator = (() => {
  const V = validator.create('axisEnergyEquilibrator');
  const axisEnergyEquilibratorConfig = {
    HOTSPOT_RATIO: 2.0,
    HOTSPOT_ABS_MIN: 0.25,
    COLDSPOT_RATIO: 0.3,
    COLDSPOT_ABS_MAX: 0.10,
    PAIR_TIGHTEN_RATE: 0.004,
    PAIR_RELAX_RATE: 0.002,
    PAIR_COOLDOWN: 3,
    RESIDUAL_P95_RATIO: 1.55,
    RESIDUAL_P95_ABS_MIN: 0.68,
    RESIDUAL_HOTSPOT_RATE: 0.12,
    RESIDUAL_SEVERE_RATE: 0.03,
    RESIDUAL_COLDSPOT_P95_MAX: 0.66,
    RESIDUAL_TIGHTEN_BONUS: 1.35,
    FAIR_SHARE: 1.0 / 6.0,
    AXIS_OVERSHOOT: 0.22,
    AXIS_UNDERSHOOT: 0.12,
    AXIS_TIGHTEN_RATE: 0.002,
    AXIS_RELAX_RATE: 0.0009,  // R25 E4: Slowed from 0.0012 to reduce Gini oscillation
    AXIS_COOLDOWN: 4,
    SHARE_EMA_ALPHA: 0.08,
    GINI_ESCALATION: 0.40,
    NON_NUDGEABLE_TAIL_SET: couplingConstants.NON_NUDGEABLE_SET,
    BASELINE_MIN: 0.04,
    DENSITY_FLICKER_BASELINE_MIN: 0.08,
    BASELINE_MAX: 0.40,
    WARMUP_DEFAULT: 16,
    PHASE_SURFACE_RATIO: 1.8,       // R81 E2: widened from 1.6 to reduce phaseSurfaceHotBeats
    PHASE_SURFACE_ABS_MIN: 0.22,    // R81 E2: widened from 0.18 to allow more coldspot relaxation
    TRUST_SURFACE_RATIO: 1.45,
    TRUST_SURFACE_ABS_MIN: 0.20,
    ENTROPY_SURFACE_RATIO: 1.35,
    ENTROPY_SURFACE_ABS_MIN: 0.18,
    COHERENT_HOTSPOT_MIN_SCALE: 0.18,
    COHERENT_HOTSPOT_MAX_SCALE: 0.42,
    EFFECTIVE_NUDGEABLE: {
      density: 5,
      tension: 5,
      flicker: 5,
      entropy: 4,
      trust: 3,
      phase: 4
    },
    RELAX_RATE_REF: 5,
    ALL_AXES: couplingConstants.ALL_MONITORED_DIMS,
    ALL_PAIRS: couplingConstants.ALL_PAIRS,
    axisToPairs: couplingConstants.AXIS_TO_PAIRS,
    PHASE_SURFACE_SET: couplingConstants.PHASE_SURFACE_SET,
    TRUST_SURFACE_SET: couplingConstants.TRUST_SURFACE_SET,
    ENTROPY_SURFACE_SET: couplingConstants.ENTROPY_SURFACE_SET
  };

  function axisEnergyEquilibratorCreateState() {
    return {
      smoothedShares: {},
      pairCooldowns: {},
      beatCount: 0,
      pairAdjustments: 0,
      axisAdjustments: 0,
      perAxisAdj: {},
      perPairAdj: {},
      lastBaselines: {},
      regimeBeats: {},
      regimePairAdj: {},
      regimeAxisAdj: {},
      regimeTightenBudget: {},
      coherentFreezeBeats: 0,
      skippedColdspotRelaxations: 0,
      coldspotSkipReasons: { coherentFreeze: 0, phaseHot: 0, trustHot: 0, residual: 0 },
      phaseSurfaceHotBeats: 0,
      trustSurfaceHotBeats: 0,
      entropySurfaceHotBeats: 0,
      coherentHotspotActuationBeats: 0,
      coherentHotspotPairAdj: 0,
      coherentHotspotAxisAdj: 0,
      phaseCollapseStreak: 0,
      phaseLowShareStreak: 0,
      lastWarmupTicks: axisEnergyEquilibratorConfig.WARMUP_DEFAULT
    };
  }

  const axisEnergyEquilibratorState = axisEnergyEquilibratorCreateState();

  function refresh() {
    const context = axisEnergyEquilibratorRefreshContext.build(axisEnergyEquilibratorState, axisEnergyEquilibratorConfig, V);
    if (!context) return;
    axisEnergyEquilibratorPairAdjustments.apply(axisEnergyEquilibratorState, axisEnergyEquilibratorConfig, context, V);
    axisEnergyEquilibratorAxisAdjustments.apply(axisEnergyEquilibratorState, axisEnergyEquilibratorConfig, context, V);
    explainabilityBus.emit('AXIS_ENERGY_EQUIL', 'all', {
      smoothedShares: Object.assign({}, axisEnergyEquilibratorState.smoothedShares),
      axisGini: context.axisGini,
      giniMult: context.giniMult,
      pairAdj: axisEnergyEquilibratorState.pairAdjustments,
      axisAdj: axisEnergyEquilibratorState.axisAdjustments,
      beat: axisEnergyEquilibratorState.beatCount
    });
  }

  function getSnapshot() {
    return {
      beatCount: axisEnergyEquilibratorState.beatCount,
      pairAdjustments: axisEnergyEquilibratorState.pairAdjustments,
      axisAdjustments: axisEnergyEquilibratorState.axisAdjustments,
      smoothedShares: Object.assign({}, axisEnergyEquilibratorState.smoothedShares),
      perAxisAdj: Object.assign({}, axisEnergyEquilibratorState.perAxisAdj),
      perPairAdj: Object.assign({}, axisEnergyEquilibratorState.perPairAdj),
      lastBaselines: Object.assign({}, axisEnergyEquilibratorState.lastBaselines),
      regimeBeats: Object.assign({}, axisEnergyEquilibratorState.regimeBeats),
      regimePairAdj: Object.assign({}, axisEnergyEquilibratorState.regimePairAdj),
      regimeAxisAdj: Object.assign({}, axisEnergyEquilibratorState.regimeAxisAdj),
      regimeTightenBudget: Object.assign({}, axisEnergyEquilibratorState.regimeTightenBudget),
      coherentFreezeBeats: axisEnergyEquilibratorState.coherentFreezeBeats,
      skippedColdspotRelaxations: axisEnergyEquilibratorState.skippedColdspotRelaxations,
      coldspotSkipReasons: Object.assign({}, axisEnergyEquilibratorState.coldspotSkipReasons),
      phaseSurfaceHotBeats: axisEnergyEquilibratorState.phaseSurfaceHotBeats,
      trustSurfaceHotBeats: axisEnergyEquilibratorState.trustSurfaceHotBeats,
      entropySurfaceHotBeats: axisEnergyEquilibratorState.entropySurfaceHotBeats,
      coherentHotspotActuationBeats: axisEnergyEquilibratorState.coherentHotspotActuationBeats,
      coherentHotspotPairAdj: axisEnergyEquilibratorState.coherentHotspotPairAdj,
      coherentHotspotAxisAdj: axisEnergyEquilibratorState.coherentHotspotAxisAdj,
      warmupTicks: axisEnergyEquilibratorState.lastWarmupTicks,
      warmupRemaining: m.max(0, axisEnergyEquilibratorState.lastWarmupTicks - axisEnergyEquilibratorState.beatCount)
    };
  }

  function reset() {
    for (let i = 0; i < axisEnergyEquilibratorConfig.ALL_AXES.length; i++) {
      const axis = axisEnergyEquilibratorConfig.ALL_AXES[i];
      if (axisEnergyEquilibratorState.smoothedShares[axis] !== undefined) {
        axisEnergyEquilibratorState.smoothedShares[axis] = axisEnergyEquilibratorState.smoothedShares[axis] * 0.7 + axisEnergyEquilibratorConfig.FAIR_SHARE * 0.3;
      }
    }
    const cooldownKeys = Object.keys(axisEnergyEquilibratorState.pairCooldowns);
    for (let i = 0; i < cooldownKeys.length; i++) axisEnergyEquilibratorState.pairCooldowns[cooldownKeys[i]] = 0;
  }

  conductorIntelligence.registerRecorder('axisEnergyEquilibrator', refresh);
  conductorIntelligence.registerStateProvider('axisEnergyEquilibrator', () => ({
    axisEnergyEquilibrator: getSnapshot()
  }));
  conductorIntelligence.registerModule('axisEnergyEquilibrator', { reset }, ['section']);

  return { getSnapshot, reset };
})();
