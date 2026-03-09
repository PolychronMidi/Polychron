// @ts-check

/**
 * Coupling Homeostasis Governor (Hypermeta #12)
 *
 * Thin orchestrator for the whole-system coupling energy governor.
 * Operates ABOVE all per-pair and per-axis mechanisms to track total
 * coupling energy, detect redistribution, and manage global gain throttle.
 *
 * Architecture: Two-speed update.
 *  - refresh() is called from the recorder pipeline (~once per measure).
 *  - tick() is called from processBeat (~once per beat-layer entry).
 *
 * All constants live in homeostasisConstants, state in homeostasisState,
 * energy analysis in homeostasisRefresh, multiplier management in
 * homeostasisTick, and floor/pressure in homeostasisFloor.
 */

couplingHomeostasis = (() => {

  function refresh() {
    homeostasisRefresh.refresh();
  }

  function tick() {
    homeostasisTick.tick();
  }

  function getFloorDampen() {
    return homeostasisFloor.getFloorDampen();
  }

  /**
   * Diagnostic snapshot for trace pipeline.
   */
  function getState() {
    const S = homeostasisState;
    return couplingHomeostasisSnapshot.buildState({
      getBudgetConstraintPressure: homeostasisFloor.getBudgetConstraintPressure,
      getFloorDampen: homeostasisFloor.getFloorDampen,
      totalEnergyEma: S.totalEnergyEma,
      energyBudget: S.energyBudget,
      peakEnergyEma: S.peakEnergyEma,
      totalEnergyFloor: S.totalEnergyFloor,
      redistributionScore: S.redistributionScore,
      nudgeableRedistributionScore: S.nudgeableRedistributionScore,
      globalGainMultiplier: S.globalGainMultiplier,
      giniCoefficient: S.giniCoefficient,
      energyDeltaEma: S.energyDeltaEma,
      pairTurbulenceEma: S.pairTurbulenceEma,
      beatCount: S.beatCount,
      invokeCount: S.invokeCount,
      tickCount: S.tickCount,
      emptyMatrixBeats: S.emptyMatrixBeats,
      multiplierMin: S.multiplierMin,
      multiplierMax: S.multiplierMax,
      multiplierTimeSeries: S.multiplierTimeSeries,
      floorRecoveryTicksRemaining: S.floorRecoveryTicksRemaining,
      densityFlickerTailPressure: S.densityFlickerTailPressure,
      stickyTailPressure: S.stickyTailPressure,
      tailRecoveryDrive: S.tailRecoveryDrive,
      tailRecoveryTrigger: S.tailRecoveryTrigger,
      tailRecoveryHandshake: S.tailRecoveryHandshake,
      tailRecoveryCap: S.tailRecoveryCap,
      tailRecoveryCeilingPressure: S.tailRecoveryCeilingPressure,
      densityFlickerClampPressure: S.densityFlickerClampPressure,
      densityFlickerOverridePressure: S.densityFlickerOverridePressure,
      recoveryAxisHandOffPressure: S.recoveryAxisHandOffPressure,
      shortRunRecoveryBias: S.shortRunRecoveryBias,
      nonNudgeableTailPressure: S.nonNudgeableTailPressure,
      nonNudgeableTailPair: S.nonNudgeableTailPair,
      recoveryDominantAxes: S.recoveryDominantAxes,
      dominantTailPair: S.dominantTailPair,
      tailHotspotCount: S.tailHotspotCount,
      tailPressureByPair: S.tailPressureByPair,
    });
  }

  function reset() {
    homeostasisState.reset();
  }

  // Self-registration
  conductorIntelligence.registerRecorder('couplingHomeostasis', refresh);
  conductorIntelligence.registerModule('couplingHomeostasis', { reset }, ['section']);

  return { getState, reset, tick, getFloorDampen };
})();
