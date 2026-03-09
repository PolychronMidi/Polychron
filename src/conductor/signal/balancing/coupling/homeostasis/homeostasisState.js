// @ts-check

/**
 * Homeostasis State
 *
 * All mutable state for the coupling homeostasis governor. Energy
 * tracking, redistribution detection, tail pressure, floor recovery,
 * multiplier management, and diagnostics. Section-reset logic dampens
 * rather than wipes to preserve cross-section learning.
 */

homeostasisState = (() => {
  const C = homeostasisConstants;

  const S = {
    // Energy tracking
    totalEnergyEma: 0,
    prevTotalEnergy: 0,
    totalEnergyFloor: 8.0,
    redistributionScore: 0,
    globalGainMultiplier: 1.0,
    energyBudget: 3.5,
    peakEnergyEma: 0,
    giniCoefficient: 0,
    beatCount: 0,

    // Redistribution
    energyDeltaEma: 0,
    pairTurbulenceEma: 0,
    nonRedistBeats: 0,
    nudgeablePairTurbulenceEma: 0,
    nudgeableRedistributionScore: 0,
    nudgeableNonRedistBeats: 0,

    // Matrix caching
    /** @type {Record<string, number>} */
    cachedMatrix: {},
    cachedMatrixAge: 0,

    // Chronic dampening
    chronicDampenBeats: 0,

    // Floor recovery
    floorRecoveryContactTicks: 0,
    floorRecoveryTicksRemaining: 0,

    // Tail pressure
    densityFlickerTailPressure: 0,
    stickyTailPressure: 0,
    dominantTailPair: '',
    tailHotspotCount: 0,
    /** @type {Record<string, number>} */
    tailPressureByPair: {},
    tailRecoveryDrive: 0,
    tailRecoveryTrigger: C.TAIL_PRESSURE_TRIGGER_MIN,
    tailRecoveryHandshake: 0,
    tailRecoveryCap: 1.0,
    tailRecoveryCeilingPressure: 0,
    densityFlickerClampPressure: 0,
    densityFlickerOverridePressure: 0,
    recoveryAxisHandOffPressure: 0,
    shortRunRecoveryBias: 0,
    nonNudgeableTailPressure: 0,
    nonNudgeableTailPair: '',
    /** @type {string[]} */
    recoveryDominantAxes: [],

    // Exceedance tracking
    /** @type {Record<string, number>} */
    exceedanceTicks: {},

    // Diagnostics
    invokeCount: 0,
    emptyMatrixBeats: 0,
    multiplierMin: 1.0,
    multiplierMax: 0.0,
    tickCount: 0,
    refreshedThisTick: false,
    overBudget: false,
    /** @type {{ beat: number, m: number, e: number, r: number }[]} */
    multiplierTimeSeries: [],

    // Per-pair correlation tracking
    /** @type {Record<string, number>} */
    pairAbsR: {},
    /** @type {Record<string, number>} */
    prevPairAbsR: {},

    /** Section reset: dampen rather than wipe. Preserves cross-section energy learning. */
    reset() {
      S.totalEnergyEma *= 0.90;
      S.prevTotalEnergy *= 0.90;
      S.redistributionScore *= 0.50;
      S.nudgeableRedistributionScore *= 0.50;
      S.energyDeltaEma *= 0.50;
      S.pairTurbulenceEma *= 0.50;
      S.nudgeablePairTurbulenceEma *= 0.50;
      S.globalGainMultiplier = S.globalGainMultiplier * 0.5 + 0.5;
      S.pairAbsR = {};
      S.prevPairAbsR = {};
      S.nonRedistBeats = 0;
      S.nudgeableNonRedistBeats = 0;
      S.chronicDampenBeats = 0;
      S.floorRecoveryContactTicks = 0;
      S.floorRecoveryTicksRemaining = 0;
      S.densityFlickerTailPressure *= 0.50;
      S.stickyTailPressure *= 0.50;
      S.tailRecoveryDrive *= 0.50;
      S.tailRecoveryTrigger = C.TAIL_PRESSURE_TRIGGER_MIN;
      S.tailRecoveryHandshake *= 0.50;
      S.tailRecoveryCap = 1.0;
      S.densityFlickerClampPressure = 0;
      S.densityFlickerOverridePressure = 0;
      S.recoveryAxisHandOffPressure = 0;
      S.shortRunRecoveryBias = 0;
      S.nonNudgeableTailPressure = 0;
      S.nonNudgeableTailPair = '';
      S.tailRecoveryCeilingPressure = 0;
      S.dominantTailPair = '';
      S.recoveryDominantAxes = [];
      S.tailHotspotCount = 0;
      const tailKeys = Object.keys(S.tailPressureByPair);
      for (let i = 0; i < tailKeys.length; i++) {
        S.tailPressureByPair[tailKeys[i]] *= 0.50;
      }
    },
  };

  return S;
})();
