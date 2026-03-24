

/**
 * Pipeline Coupling Manager
 *
 * Thin orchestrator for the self-tuning decorrelation engine. Reads the
 * full coupling matrix from systemDynamicsProfiler each beat, delegates
 * to coupling helpers for gain adaptation, effective gain computation,
 * and bias accumulation. All state lives in couplingState; all constants
 * in couplingConstants.
 *
 * Nudgeable axes: density, tension, flicker (conductor biases exist).
 * Entropy/trust/phase have no conductor bias -- for pairs involving them,
 * the nudgeable partner is nudged.
 */

pipelineCouplingManager = (() => {
  const { ALL_MONITORED_DIMS } = couplingConstants;
  const getPairTailTelemetry = pipelineCouplingManagerSnapshot.getPairTailTelemetry;
  const S = couplingState;
  const pipelineCouplingManagerCache = {
    adaptiveTargetSnapshot: null,
    axisCouplingTotals: null,
    axisEnergyShare: null,
    couplingGates: null,
  };

  function pipelineCouplingManagerInvalidateCache() {
    pipelineCouplingManagerCache.adaptiveTargetSnapshot = null;
    pipelineCouplingManagerCache.axisCouplingTotals = null;
    pipelineCouplingManagerCache.axisEnergyShare = null;
    pipelineCouplingManagerCache.couplingGates = null;
  }

  /** @param {number} scale */
  function setDensityFlickerGainScale(scale) {
    S.densityFlickerGainCeiling = couplingConstants.GAIN_MAX * scale;
  }

  /** @param {number} scale */
  function setGlobalGainMultiplier(scale) {
    S.globalGainMultiplier = clamp(scale, 0.10, 1.0);
  }

  function refresh() {
    pipelineCouplingManagerInvalidateCache();
    const snap = systemDynamicsProfiler.getSnapshot();
    if (!snap || !snap.couplingMatrix) {
      S.biasDensity = 1.0;
      S.biasTension = 1.0;
      S.biasFlicker = 1.0;
      explainabilityBus.emit('COUPLING_SKIP', 'both', { reason: 'no profiler snapshot yet' });
      return;
    }

    const setup = couplingRefreshSetup.run(snap);
    if (setup.budgetConstraintActive) couplingBudgetScoring.compute(setup);
    couplingBiasAccumulator.computeAxisTotals(setup.matrix);

    // Nudge accumulators
    const nudges = {
      D: 0, T: 0, F: 0,
      DPos: 0, DNeg: 0, TPos: 0, TNeg: 0, FPos: 0, FNeg: 0,
      DBypass: 0, TBypass: 0, FBypass: 0,
    };
    /** @param {string} axis  @param {number} amount  @param {boolean} [bypass] */
    function addNudge(axis, amount, bypass) {
      if (bypass) {
        if (axis === 'density') nudges.DBypass += amount;
        else if (axis === 'tension') nudges.TBypass += amount;
        else nudges.FBypass += amount;
      } else if (axis === 'density') {
        nudges.D += amount;
        if (amount >= 0) nudges.DPos += amount; else nudges.DNeg += amount;
      } else if (axis === 'tension') {
        nudges.T += amount;
        if (amount >= 0) nudges.TPos += amount; else nudges.TNeg += amount;
      } else {
        nudges.F += amount;
        if (amount >= 0) nudges.FPos += amount; else nudges.FNeg += amount;
      }
    }

    // Per-pair loop
    for (let a = 0; a < ALL_MONITORED_DIMS.length; a++) {
      for (let b = a + 1; b < ALL_MONITORED_DIMS.length; b++) {
        const dimA = ALL_MONITORED_DIMS[a];
        const dimB = ALL_MONITORED_DIMS[b];
        const key = dimA + '-' + dimB;
        const corr = setup.matrix[key];
        if (typeof corr !== 'number' || !Number.isFinite(corr)) continue;

        const absCorr = m.abs(corr);
        const target0 = S.getTarget(key) * setup.targetScale;
        const ps = S.getPairState(key);
        ps.lastEffectiveGain = 0;

        const flags = couplingConstants.classifyPair(key, dimA, dimB);
        const tailTelemetry = getPairTailTelemetry(ps);
        const sp = couplingEffectiveGain.computeSurfacePressures(
          key, absCorr, tailTelemetry.p95, tailTelemetry, target0, setup, flags);
        const target = sp.adjustedTarget;

        // R85 E1: Non-nudgeable pairs always skip nudging. The R82-R84
        // conditional engagement experiment is removed -- entropy-trust
        // rawRollingAbsCorr (0.285) operates within its structural target
        // (0.30), ratio 0.95x. The 6.0x threshold was never reachable.
        if (flags.isNonNudgeablePair) {
          couplingGainEscalation.handleNonNudgeable(key, ps, absCorr, flags.isEntropyPair, setup.dynTelemetryWindow);
          continue;
        }

        const { axisGainScale } = couplingGainEscalation.processGain(
          key, dimA, dimB, corr, absCorr, target, ps, tailTelemetry, setup, flags, sp.nonNudgeableHandOffPressure);

        if (absCorr <= target) { ps.lastEffectiveGain = 0; continue; }

        couplingEffectiveGain.computeAndNudge(
          key, dimA, dimB, corr, absCorr, target, ps, tailTelemetry, setup, flags, sp, axisGainScale, addNudge);
      }
    }

    couplingBiasAccumulator.snapshotPrevBeat(setup.matrix);
    couplingBiasAccumulator.processHPPromotion();
    couplingBiasAccumulator.finalize(nudges, setup);
  }

  function densityBias() { return S.biasDensity; }
  function tensionBias() { return S.biasTension; }
  function flickerBias() { return S.biasFlicker; }

  /** @returns {any} */
  function getAdaptiveTargetSnapshot() {
    if (!pipelineCouplingManagerCache.adaptiveTargetSnapshot) {
      pipelineCouplingManagerCache.adaptiveTargetSnapshot = pipelineCouplingManagerSnapshot.buildAdaptiveTargetSnapshot({
        adaptiveTargets: S.adaptiveTargets,
        pairState: S.pairState,
        nonNudgeableSet: couplingConstants.NON_NUDGEABLE_SET,
        budgetPriorityScore: S.budgetPriorityScore,
        budgetPriorityBoost: S.budgetPriorityBoost,
        budgetPriorityRank: S.budgetPriorityRank,
        hpPromotedPair: S.hpPromotedPair,
      });
    }
    return pipelineCouplingManagerCache.adaptiveTargetSnapshot;
  }

  /** @returns {any} */
  function getAxisCouplingTotals() {
    if (!pipelineCouplingManagerCache.axisCouplingTotals) {
      pipelineCouplingManagerCache.axisCouplingTotals = pipelineCouplingManagerSnapshot.buildAxisCouplingTotals(S.axisSmoothedAbsR);
    }
    return pipelineCouplingManagerCache.axisCouplingTotals;
  }

  /** @returns {any} */
  function getAxisEnergyShare() {
    if (!pipelineCouplingManagerCache.axisEnergyShare) {
      pipelineCouplingManagerCache.axisEnergyShare = pipelineCouplingManagerSnapshot.buildAxisEnergyShare(S.axisSmoothedAbsR);
    }
    return pipelineCouplingManagerCache.axisEnergyShare;
  }

  /** @returns {any} */
  function getCouplingGates() {
    if (!pipelineCouplingManagerCache.couplingGates) {
      pipelineCouplingManagerCache.couplingGates = pipelineCouplingManagerSnapshot.buildCouplingGates({
        lastGateD: S.lastGateD, lastGateT: S.lastGateT, lastGateF: S.lastGateF,
        lastFloorDampen: S.lastFloorDampen,
        lastBypassD: S.lastBypassD, lastBypassT: S.lastBypassT, lastBypassF: S.lastBypassF,
        gateMinD: S.gateMinD, gateMinT: S.gateMinT, gateMinF: S.gateMinF,
        gateEmaD: S.gateEmaD, gateEmaT: S.gateEmaT, gateEmaF: S.gateEmaF,
        gateBeatCount: S.gateBeatCount,
      });
    }
    return pipelineCouplingManagerCache.couplingGates;
  }

  /** @param {string} pairKey  @param {number} newBaseline */
  function setPairBaseline(pairKey, newBaseline) {
    const clamped = clamp(newBaseline, couplingConstants.TARGET_MIN, couplingConstants.TARGET_MAX);
    const at = S.getAdaptiveTarget(pairKey);
    let ratio = 1.0;
    if (m.abs(at.baseline) > 0.02) ratio = at.current / at.baseline;
    ratio = clamp(ratio, -1.0, 3.0);
    at.baseline = clamped;
    at.current = clamp(clamped * ratio, couplingConstants.TARGET_MIN, S.getTargetMax(pairKey));
    pipelineCouplingManagerInvalidateCache();
  }

  function getPairBaselines() {
    /** @type {Record<string, number>} */
    const result = {};
    const keys = Object.keys(couplingConstants.PAIR_TARGETS);
    for (let i = 0; i < keys.length; i++) {
      const at = S.getAdaptiveTarget(keys[i]);
      result[keys[i]] = at.baseline;
    }
    return result;
  }

  function reset() {
    S.reset();
    pipelineCouplingManagerInvalidateCache();
  }

  // Self-registration
  conductorIntelligence.registerDensityBias('pipelineCouplingManager', densityBias, 0.80, 1.20);
  conductorIntelligence.registerTensionBias('pipelineCouplingManager', tensionBias, 0.80, 1.22);
  conductorIntelligence.registerFlickerModifier('pipelineCouplingManager', flickerBias, 0.70, 1.30);
  conductorIntelligence.registerRecorder('pipelineCouplingManager', refresh);
  conductorIntelligence.registerModule('pipelineCouplingManager', { reset }, ['section']);

  feedbackRegistry.registerLoop(
    'pipelineCouplingManager',
    'coupling_matrix',
    'density_tension_flicker',
    () => (m.abs(S.biasDensity - 1.0) + m.abs(S.biasTension - 1.0) + m.abs(S.biasFlicker - 1.0)) / 0.60,
    () => m.sign(S.biasTension - 1.0)
  );

  return {
    densityBias, tensionBias, flickerBias,
    setDensityFlickerGainScale, setGlobalGainMultiplier,
    setPairBaseline, getPairBaselines,
    getAdaptiveTargetSnapshot, getAxisCouplingTotals, getAxisEnergyShare, getCouplingGates,
    reset,
  };
})();
