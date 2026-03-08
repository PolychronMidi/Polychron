couplingHomeostasisSnapshot = (() => {
  function buildState(args) {
    let floorContactBeats = 0;
    let ceilingContactBeats = 0;
    let multiplierSum = 0;
    let multiplierSqSum = 0;
    const tsLen = args.multiplierTimeSeries.length;
    const recoveryDurations = [];
    let inFloorContact = false;
    let floorStart = 0;

    for (let i = 0; i < tsLen; i++) {
      const multiplierValue = args.multiplierTimeSeries[i].m;
      multiplierSum += multiplierValue;
      multiplierSqSum += multiplierValue * multiplierValue;
      if (multiplierValue <= 0.21) {
        floorContactBeats++;
        if (!inFloorContact) {
          inFloorContact = true;
          floorStart = i;
        }
      } else if (multiplierValue >= 0.99) {
        ceilingContactBeats++;
      }
      if (inFloorContact && multiplierValue > 0.50) {
        recoveryDurations.push(i - floorStart);
        inFloorContact = false;
      }
    }

    const multiplierMean = tsLen > 0 ? multiplierSum / tsLen : 0;
    const multiplierVariance = tsLen > 1
      ? (multiplierSqSum / tsLen - multiplierMean * multiplierMean)
      : 0;
    const multiplierStdDev = m.sqrt(m.max(0, multiplierVariance));
    const avgRecoveryDuration = recoveryDurations.length > 0
      ? recoveryDurations.reduce((a, b) => a + b, 0) / recoveryDurations.length
      : 0;
    const budgetConstraintPressure = args.getBudgetConstraintPressure();

    return {
      totalEnergyEma: Number(args.totalEnergyEma.toFixed(4)),
      energyBudget: Number(args.energyBudget.toFixed(4)),
      peakEnergyEma: Number(args.peakEnergyEma.toFixed(4)),
      totalEnergyFloor: Number(args.totalEnergyFloor.toFixed(4)),
      floorDampen: Number(args.getFloorDampen().toFixed(4)),
      redistributionScore: Number(args.redistributionScore.toFixed(4)),
      nudgeableRedistributionScore: Number(args.nudgeableRedistributionScore.toFixed(4)),
      budgetConstraintActive: budgetConstraintPressure > 0.25,
      budgetConstraintPressure: Number(budgetConstraintPressure.toFixed(4)),
      globalGainMultiplier: Number(args.globalGainMultiplier.toFixed(4)),
      giniCoefficient: Number(args.giniCoefficient.toFixed(4)),
      energyDeltaEma: Number(args.energyDeltaEma.toFixed(4)),
      pairTurbulenceEma: Number(args.pairTurbulenceEma.toFixed(4)),
      beatCount: args.beatCount,
      invokeCount: args.invokeCount,
      tickCount: args.tickCount,
      emptyMatrixBeats: args.emptyMatrixBeats,
      multiplierMin: Number(args.multiplierMin.toFixed(4)),
      multiplierMax: Number(args.multiplierMax.toFixed(4)),
      multiplierStdDev: Number(multiplierStdDev.toFixed(4)),
      floorContactBeats,
      ceilingContactBeats,
      avgRecoveryDuration: Number(avgRecoveryDuration.toFixed(1)),
      floorRecoveryActive: args.floorRecoveryTicksRemaining > 0,
      floorRecoveryTicksRemaining: args.floorRecoveryTicksRemaining,
      densityFlickerTailPressure: Number(args.densityFlickerTailPressure.toFixed(4)),
      stickyTailPressure: Number(args.stickyTailPressure.toFixed(4)),
      tailRecoveryDrive: Number(args.tailRecoveryDrive.toFixed(4)),
      tailRecoveryTrigger: Number(args.tailRecoveryTrigger.toFixed(4)),
      tailRecoveryHandshake: Number(args.tailRecoveryHandshake.toFixed(4)),
      tailRecoveryCap: Number(args.tailRecoveryCap.toFixed(4)),
      tailRecoveryCeilingPressure: Number(args.tailRecoveryCeilingPressure.toFixed(4)),
      densityFlickerClampPressure: Number(args.densityFlickerClampPressure.toFixed(4)),
      densityFlickerOverridePressure: Number(args.densityFlickerOverridePressure.toFixed(4)),
      recoveryAxisHandOffPressure: Number(args.recoveryAxisHandOffPressure.toFixed(4)),
      shortRunRecoveryBias: Number(args.shortRunRecoveryBias.toFixed(4)),
      nonNudgeableTailPressure: Number(args.nonNudgeableTailPressure.toFixed(4)),
      nonNudgeableTailPair: args.nonNudgeableTailPair,
      recoveryDominantAxes: args.recoveryDominantAxes.slice(),
      dominantTailPair: args.dominantTailPair,
      tailHotspotCount: args.tailHotspotCount,
      tailPressureByPair: Object.assign({}, args.tailPressureByPair),
    };
  }

  return {
    buildState,
  };
})();
