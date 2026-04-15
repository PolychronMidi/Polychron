pipelineCouplingManagerSnapshot = (() => {
  const V = validator.create('pipelineCouplingManagerSnapshot');
  function computeP95(arr) {
    if (arr.length < 4) return 0;
    const sorted = arr.slice().sort((a, b) => a - b);
    const idx = m.floor(sorted.length * 0.95);
    return sorted[m.min(idx, sorted.length - 1)];
  }

  function computeExceedanceRate(arr, threshold) {
    V.assertArray(arr, 'arr');
    if (arr.length === 0) return 0;
    let count = 0;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] > threshold) count++;
    }
    return count / arr.length;
  }

  function pushWindowValue(arr, value, limit) {
    arr.push(value);
    if (arr.length > limit) arr.shift();
  }

  function getPairTailTelemetry(pairState) {
    const recent = pairState ? pairState.recentAbsCorr : [];
    const telemetry = pairState ? pairState.telemetryAbsCorr : [];
    return {
      recentP95: computeP95(recent),
      recentHotspotRate: computeExceedanceRate(recent, 0.70),
      recentSevereRate: computeExceedanceRate(recent, 0.85),
      p95: computeP95(telemetry),
      hotspotRate: computeExceedanceRate(telemetry, 0.70),
      severeRate: computeExceedanceRate(telemetry, 0.85),
      telemetryBeats: telemetry.length,
    };
  }

  function buildAdaptiveTargetSnapshot(args) {
    const result = {};
    const keys = Object.keys(args.adaptiveTargets);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const adaptiveTarget = args.adaptiveTargets[key];
      const pairState = args.pairState[key];
      const nudgeable = !args.nonNudgeableSet.has(key);
      const tailTelemetry = getPairTailTelemetry(pairState);
      const pairP95 = tailTelemetry.p95;
      const hotspotRate = tailTelemetry.hotspotRate;
      const severeRate = tailTelemetry.severeRate;
      const residualPressure = clamp(
        clamp((pairP95 - m.max(adaptiveTarget.current + 0.22, 0.68)) / 0.16, 0, 1) * 0.65 +
        clamp((hotspotRate - 0.10) / 0.20, 0, 1) * 0.20 +
        clamp((severeRate - 0.02) / 0.10, 0, 1) * 0.15,
        0,
        1
      );
      result[key] = {
        baseline: adaptiveTarget.baseline,
        current: Number(adaptiveTarget.current.toFixed(4)),
        rollingAbsCorr: Number(adaptiveTarget.rollingAbsCorr.toFixed(4)),
        rawRollingAbsCorr: Number(adaptiveTarget.rawRollingAbsCorr.toFixed(4)),
        p95AbsCorr: Number(pairP95.toFixed(4)),
        hotspotRate: Number(hotspotRate.toFixed(4)),
        severeRate: Number(severeRate.toFixed(4)),
        recentP95AbsCorr: Number(tailTelemetry.recentP95.toFixed(4)),
        recentHotspotRate: Number(tailTelemetry.recentHotspotRate.toFixed(4)),
        recentSevereRate: Number(tailTelemetry.recentSevereRate.toFixed(4)),
        telemetryWindowBeats: tailTelemetry.telemetryBeats,
        residualPressure: Number(residualPressure.toFixed(4)),
        gain: pairState ? Number(pairState.gain.toFixed(4)) : 0,
        effectiveGain: pairState ? Number((V.optionalFinite(pairState.lastEffectiveGain, 0)).toFixed(4)) : 0,
        nudgeable,
        budgetScore: args.budgetPriorityScore[key] !== undefined ? args.budgetPriorityScore[key] : 0,
        budgetBoost: args.budgetPriorityBoost[key] !== undefined ? args.budgetPriorityBoost[key] : 1,
        budgetRank: args.budgetPriorityRank[key] !== undefined ? args.budgetPriorityRank[key] : null,
        heatPenalty: pairState ? Number((V.optionalFinite(pairState.heatPenalty, 0)).toFixed(4)) : 0,
        effectivenessEma: pairState ? Number((pairState.effectivenessEma ?? 0.5).toFixed(4)) : 0.5,
        effMin: pairState ? Number((pairState.effMin !== undefined ? pairState.effMin : 1.0).toFixed(4)) : 1.0,
        effMax: pairState ? Number((pairState.effMax !== undefined ? pairState.effMax : 0.0).toFixed(4)) : 0.0,
        effActiveBeats: pairState ? (V.optionalFinite(pairState.effActiveBeats, 0)) : 0,
        hpPromoted: key === args.hpPromotedPair,
      };
    }
    return result;
  }

  function buildAxisCouplingTotals(axisSmoothedAbsR) {
    const result = {};
    const axisKeys = Object.keys(axisSmoothedAbsR);
    for (let i = 0; i < axisKeys.length; i++) {
      result[axisKeys[i]] = Number(axisSmoothedAbsR[axisKeys[i]].toFixed(4));
    }
    return result;
  }

  function buildAxisEnergyShare(axisSmoothedAbsR) {
    const totals = buildAxisCouplingTotals(axisSmoothedAbsR);
    const keys = Object.keys(totals);
    let sum = 0;
    for (let i = 0; i < keys.length; i++) sum += totals[keys[i]];
    const shares = {};
    if (sum < 0.001 || keys.length === 0) {
      for (let i = 0; i < keys.length; i++) shares[keys[i]] = 0;
      return { shares, axisGini: 0 };
    }
    const values = [];
    for (let i = 0; i < keys.length; i++) {
      const share = totals[keys[i]] / sum;
      shares[keys[i]] = Number(share.toFixed(4));
      values.push(share);
    }
    values.sort((a, b) => a - b);
    const n = values.length;
    let rankSum = 0;
    for (let i = 0; i < n; i++) rankSum += (i + 1) * values[i];
    const axisGini = n > 1 ? clamp((2 * rankSum) / n - (n + 1) / n, 0, 1) : 0;
    return { shares, axisGini: Number(axisGini.toFixed(4)) };
  }

  function buildCouplingGates(state) {
    return {
      gateD: state.lastGateD,
      gateT: state.lastGateT,
      gateF: state.lastGateF,
      floorDampen: state.lastFloorDampen,
      bypassD: state.lastBypassD,
      bypassT: state.lastBypassT,
      bypassF: state.lastBypassF,
      gateMinD: Number(state.gateMinD.toFixed(4)),
      gateMinT: Number(state.gateMinT.toFixed(4)),
      gateMinF: Number(state.gateMinF.toFixed(4)),
      gateEmaD: Number(state.gateEmaD.toFixed(4)),
      gateEmaT: Number(state.gateEmaT.toFixed(4)),
      gateEmaF: Number(state.gateEmaF.toFixed(4)),
      gateBeatCount: state.gateBeatCount,
    };
  }

  return {
    buildAdaptiveTargetSnapshot,
    buildAxisCouplingTotals,
    buildAxisEnergyShare,
    buildCouplingGates,
    computeExceedanceRate,
    computeP95,
    getPairTailTelemetry,
    pushWindowValue,
  };
})();
