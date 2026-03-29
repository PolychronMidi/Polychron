// systemHealth.js -- system health computation, phase classification,
// controller effectiveness tracking, and controller state gathering.

hyperMetaManagerHealth = (() => {
  const V = validator.create('systemHealth');
  const ST = hyperMetaManagerState;
  const C  = ST;                       // constants live on the same object
  const S  = ST.S;

  // CONTROLLER STATE SAMPLING

  /**
   * Gather snapshots from all queryable controllers.
   * @returns {{ phaseFloor: any, pairCeiling: any, warmupRamp: any, watchdog: any, homeostasis: any, registry: any, profiler: any, criticality: any, dimExpander: any }}
   */
  function gatherControllerState() {
    return {
      phaseFloor:        safePreBoot.call(() => phaseFloorController.getSnapshot(), null),
      pairCeiling:       safePreBoot.call(() => pairGainCeilingController.getSnapshot(), null),
      warmupRamp:        safePreBoot.call(() => warmupRampController.getSnapshot(), null),
      watchdog:          safePreBoot.call(() => conductorMetaWatchdog.getSnapshot(), null),
      homeostasis:       safePreBoot.call(() => couplingHomeostasis.getState(), null),
      registry:          safePreBoot.call(() => metaControllerRegistry.getSnapshot(), null),
      profiler:          safePreBoot.call(() => systemDynamicsProfiler.getSnapshot(), null),
      criticality:       safePreBoot.call(() => criticalityEngine.getState(), null),
      dimExpander:       safePreBoot.call(() => dimensionalityExpander.getSnapshot(), null),
    };
  }

  // SYSTEM HEALTH

  /**
   * Compute composite system health from controller snapshots.
   * Health is a [0,1] score: 1 = all controllers converged, 0 = total chaos.
   * @param {ReturnType<typeof gatherControllerState>} state
   * @returns {number}
   */
  function computeSystemHealth(state) {
    let health = 1.0;

    // Phase health: penalize collapsed phase share
    if (state.phaseFloor) {
      const phasePenalty = clamp((0.10 - state.phaseFloor.shareEma) / 0.10, 0, 1);
      health -= phasePenalty * 0.25;
    }

    // Exceedance health: penalize high p95 across pairs
    if (state.pairCeiling) {
      const pairs = Object.keys(state.pairCeiling);
      let maxP95 = 0;
      for (let i = 0; i < pairs.length; i++) {
        const ps = state.pairCeiling[pairs[i]];
        if (ps && ps.p95Ema > maxP95) maxP95 = ps.p95Ema;
      }
      health -= clamp((maxP95 - 0.80) / 0.15, 0, 1) * 0.30;
    }

    // Watchdog conflicts: penalize active attenuations
    if (state.watchdog) {
      let activeAttenuations = 0;
      const pipelines = Object.keys(state.watchdog);
      for (let i = 0; i < pipelines.length; i++) {
        const controllers = Object.keys(state.watchdog[pipelines[i]]);
        for (let j = 0; j < controllers.length; j++) {
          if (state.watchdog[pipelines[i]][controllers[j]] < 0.9) activeAttenuations++;
        }
      }
      health -= clamp(activeAttenuations * 0.08, 0, 0.25);
    }

    // Energy balance: penalize homeostasis throttling
    if (state.homeostasis && state.homeostasis.globalGainMultiplier < 0.8) {
      health -= clamp((0.8 - state.homeostasis.globalGainMultiplier) * 0.5, 0, 0.20);
    }

    return clamp(health, 0, 1);
  }

  // SYSTEM PHASE DETECTION

  /**
   * Classify the system's current macro phase.
   * @returns {'converging' | 'oscillating' | 'stabilized'}
   */
  function classifySystemPhase() {
    if (S.healthEma > 0.80 && S.exceedanceTrendEma < 0.05) return 'stabilized';
    if (S.totalInterventionEma > C.INTERVENTION_BUDGET * 0.8 &&
        m.abs(S.healthEma - 0.7) > 0.15) return 'oscillating';
    return 'converging';
  }

  // EFFECTIVENESS TRACKING

  /**
   * @param {string} name
   * @param {number} contribution
   */
  function updateControllerEffectiveness(name, contribution) {
    if (!ST.controllerStats[name]) {
      ST.controllerStats[name] = { effectivenessEma: 0.5, interventionCount: 0, lastContribution: 0 };
    }
    const stats = ST.controllerStats[name];
    stats.effectivenessEma += (clamp(contribution + 0.5, 0, 1) - stats.effectivenessEma) * C.EFFECTIVENESS_EMA_ALPHA;
    stats.interventionCount++;
    stats.lastContribution = contribution;
  }

  /**
   * Track effectiveness of each controller: did their intervention improve health?
   * @param {number} healthBefore
   * @param {number} healthAfter
   * @param {ReturnType<typeof gatherControllerState>} state
   */
  function updateEffectiveness(healthBefore, healthAfter, state) {
    const improvement = healthAfter - healthBefore;

    if (state.phaseFloor && state.phaseFloor.beatCount > 0) {
      updateControllerEffectiveness('phaseFloorController',
        state.phaseFloor.shareEma > state.phaseFloor.collapseThreshold ? 0.3 : -0.1);
    }

    if (state.pairCeiling) {
      const pairs = Object.keys(state.pairCeiling);
      let avgP95 = 0;
      for (let i = 0; i < pairs.length; i++) avgP95 += state.pairCeiling[pairs[i]].p95Ema;
      if (pairs.length > 0) avgP95 /= pairs.length;
      updateControllerEffectiveness('pairGainCeilingController', avgP95 < 0.85 ? 0.2 : -0.05);
    }

    updateControllerEffectiveness('system', improvement);
  }

  // CORRELATION TREND MONITORING

  /**
   * Detect simultaneous sign flips in the coupling correlation matrix.
   * @param {ReturnType<typeof gatherControllerState>} state
   * @returns {number} flip count this tick
   */
  function detectCorrelationFlips(state) {
    if (!state.profiler || !state.profiler.couplingMatrix) return 0;

    const matrix = state.profiler.couplingMatrix;
    const pairs = Object.keys(matrix);
    let flipCount = 0;

    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      const corr = matrix[pair];
      if (Number.isNaN(corr)) continue;

      const sign = corr > 0.05 ? 1 : (corr < -0.05 ? -1 : 0);
      const prev = ST.prevCorrSign[pair];

      if (prev !== undefined && prev !== 0 && sign !== 0 && prev !== sign) flipCount++;
      ST.prevCorrSign[pair] = sign;
    }

    S.lastFlipCount = flipCount;
    return flipCount;
  }

  // AXIS CONCENTRATION

  /**
   * Track exceedance per axis for concentration diagnostic.
   * @param {string} pair
   */
  function recordExceedance(pair) {
    const axes = pair.split('-');
    for (let i = 0; i < axes.length; i++) {
      ST.axisExceedanceCounts[axes[i]] = (ST.axisExceedanceCounts[axes[i]] || 0) + 1;
    }
    // Per-pair tracking for monopoly detection (E1)
    ST.pairExceedanceCounts[pair] = (V.optionalFinite(ST.pairExceedanceCounts[pair], 0)) + 1;
  }

  /**
   * Detect if a single pair dominates exceedance counts (>75% of total).
   * Returns the monopoly pair key and its share, or null.
   * @returns {{ pair: string, share: number } | null}
   */
  function getPairMonopoly() {
    const pairs = Object.keys(ST.pairExceedanceCounts);
    if (pairs.length < 2) return null;
    let total = 0, maxCount = 0, monopolyPair = '';
    for (let i = 0; i < pairs.length; i++) {
      const c = ST.pairExceedanceCounts[pairs[i]];
      total += c;
      if (c > maxCount) { maxCount = c; monopolyPair = pairs[i]; }
    }
    if (total < 10) return null; // not enough data
    const share = maxCount / total;
    return share > 0.75 ? { pair: monopolyPair, share } : null;
  }

  /**
   * @returns {{ axisExceedance: Record<string, number>, concentration: number, dominantAxis: string }}
   */
  function getAxisConcentration() {
    const axes = Object.keys(ST.axisExceedanceCounts);
    if (axes.length === 0) return { axisExceedance: Object.create(null), concentration: 0, dominantAxis: 'none' };

    let total = 0, maxCount = 0, dominantAxis = axes[0];
    for (let i = 0; i < axes.length; i++) {
      const count = ST.axisExceedanceCounts[axes[i]];
      total += count;
      if (count > maxCount) { maxCount = count; dominantAxis = axes[i]; }
    }

    return {
      axisExceedance: Object.assign({}, ST.axisExceedanceCounts),
      concentration: total > 0 ? maxCount / total : 0,
      dominantAxis,
    };
  }

  return {
    gatherControllerState,
    computeSystemHealth,
    classifySystemPhase,
    updateEffectiveness,
    detectCorrelationFlips,
    recordExceedance,
    getAxisConcentration,
    getPairMonopoly,
  };
})();
