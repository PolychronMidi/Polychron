// hyperMetaManager.js -- main orchestration tick and public API.
// Assembles all sub-modules (state, systemHealth, contradictions,
// topologyIntelligence, telemetryReconciliation) into the unified
// hyper-meta orchestrator that downstream controllers query.

/**
 * @typedef {Object} hyperMetaManagerAPI
 * @property {function(string): number} getRateMultiplier
 * @property {function(): number} getPhaseBoostCeiling
 * @property {function(): number} getP95AlphaMultiplier
 * @property {function(): number} getS0TighteningMultiplier
 * @property {function(): 'converging' | 'oscillating' | 'stabilized'} getSystemPhase
 * @property {function(): number} getVarianceGateRelaxMultiplier
 * @property {function(): number} getTopologyCreativityMultiplier
 * @property {function(): 'crystallized' | 'resonant' | 'fluid'} getTopologyPhase
 * @property {function(): 'emergence' | 'locked' | 'seeking' | 'dampened'} getCrossState
 * @property {function(string): void} recordExceedance
 * @property {function(): { axisExceedance: Record<string, number>, concentration: number, dominantAxis: string }} getAxisConcentration
 * @property {function(): any} getSnapshot
 * @property {function(): void} reset
 */

/**
 * @global
 * @type {hyperMetaManagerAPI}
 */
hyperMetaManager = (() => {
  const ST     = hyperMetaManagerState;
  const S      = ST.S;
  const health = hyperMetaManagerHealth;
  const contra = hyperMetaManagerContradictions;
  const topo   = hyperMetaManagerTopology;
  const telem  = hyperMetaManagerTelemetry;

  // MAIN ORCHESTRATION TICK

  function tick() {
    S.beatCount++;
    if (S.beatCount % ST.ORCHESTRATE_INTERVAL !== 0) return;

    const healthBefore = S.healthEma;
    const state = health.gatherControllerState();

    // 1. System health
    const rawHealth = health.computeSystemHealth(state);
    S.healthEma += (rawHealth - S.healthEma) * ST.HEALTH_EMA_ALPHA;

    // 2. Exceedance trend
    if (state.pairCeiling) {
      const pairs = Object.keys(state.pairCeiling);
      let total = 0;
      for (let i = 0; i < pairs.length; i++) total += state.pairCeiling[pairs[i]].exceedanceEma || 0;
      S.exceedanceTrendEma += (total - S.exceedanceTrendEma) * ST.HEALTH_EMA_ALPHA;
    }

    // 3. Phase health trend
    if (state.phaseFloor) {
      S.phaseTrendEma += (state.phaseFloor.shareEma - S.phaseTrendEma) * ST.HEALTH_EMA_ALPHA;
    }

    // 4. System phase
    S.systemPhase = health.classifySystemPhase();

    // 5. Rate multipliers
    contra.updateRateMultipliers(state);

    // 6. Contradiction detection
    contra.detectContradictions(state);

    // 7. Effectiveness tracking
    health.updateEffectiveness(healthBefore, S.healthEma, state);

    // 8. Correlation flips -- dampen on multi-axis oscillation
    const corrFlips = health.detectCorrelationFlips(state);
    if (corrFlips >= 2) ST.rateMultipliers.global *= 0.90;

    // 9. Topology intelligence
    topo.update(state);

    // 10. Telemetry reconciliation & trust velocity
    telem.updateReconciliation(state);
    telem.applyTrustVelocityDamping(state);
    telem.checkPhaseTelemetryIntegrity(state);

    // 11. Apply topology creativity to global rate
    ST.rateMultipliers.global *= S.topologyCreativityMultiplier;

    // 12. Criticality engine awareness. During emergence, suppress
    // avalanche snap strength to let novel patterns express. During
    // locked state, amplify snap to help break crystallization.
    if (S.crossState === 'emergence') {
      ST.rateMultipliers.criticalitySnap = clamp(0.5 - S.emergenceStreak * 0.02, 0.25, 0.5);
    } else if (S.crossState === 'locked') {
      ST.rateMultipliers.criticalitySnap = 1.2;
    } else {
      // Relax toward neutral
      ST.rateMultipliers.criticalitySnap = 1.0 +
        ((ST.rateMultipliers.criticalitySnap || 1.0) - 1.0) * 0.8;
    }

    // 13. Dimensionality expander ceiling floor. During locked state,
    // preserve minimum ceiling capacity for expander-driven nudges
    // when dimensionality is collapsing.
    if (S.crossState === 'locked' && state.dimExpander && state.dimExpander.urgency > 0) {
      ST.rateMultipliers.dimExpanderCeilingFloor =
        clamp(0.06 + state.dimExpander.urgency * 0.04, 0.06, 0.10);
    } else {
      ST.rateMultipliers.dimExpanderCeilingFloor = 0;
    }

    // 14. E1-E5 Evolutions orchestration
    // E1: Hotspot monopoly relief
    const monopoly = health.getPairMonopoly();
    if (monopoly) {
      ST.rateMultipliers['hotspotMonopolyRelief_' + monopoly.pair] =
        1.0 + (monopoly.share - 0.75) * 4.0;
    }
    const rmKeys = Object.keys(ST.rateMultipliers);
    for (let ri = 0; ri < rmKeys.length; ri++) {
      if (rmKeys[ri].indexOf('hotspotMonopolyRelief_') === 0) {
        if (!monopoly || rmKeys[ri] !== 'hotspotMonopolyRelief_' + monopoly.pair) {
          ST.rateMultipliers[rmKeys[ri]] *= 0.8;
          if (ST.rateMultipliers[rmKeys[ri]] < 1.01) delete ST.rateMultipliers[rmKeys[ri]];
        }
      }
    }

    // E2: Homeostasis stress detection
    if (state.homeostasis) {
      const ggm = state.homeostasis.globalGainMultiplier;
      if (typeof ggm === 'number' && ggm < 0.65) {
        const stressDampen = clamp(1.0 - (0.65 - ggm) * 2.0, 0.7, 1.0);
        ST.rateMultipliers.global *= stressDampen;
      }
    }

    // E3: Emergence-regime reinforcement
    if (state.profiler && state.profiler.regime === 'exploring' &&
        (S.crossState === 'emergence' || S.crossState === 'seeking')) {
      S.topologyCreativityMultiplier = m.min(1.30, S.topologyCreativityMultiplier * 1.05);
    }

    // E4: Section-aware tension floor protection
    {
      let secProg = 0;
      try { secProg = clamp(safePreBoot.call(() => timeStream.compoundProgress('section'), 0) || 0, 0, 1); } catch { void 0; }
      const currentTension = safePreBoot.call(() => signalReader.tension(), 1.0) || 1.0;
      if (secProg < 0.3 && currentTension < 0.75) {
        ST.rateMultipliers.tensionFloorProtection = clamp(1.5 + (0.75 - currentTension) * 2.0, 1.5, 2.5);
      } else {
        ST.rateMultipliers.tensionFloorProtection =
          m.max(1.0, (ST.rateMultipliers.tensionFloorProtection || 1.0) * 0.9);
      }
    }

    // E5: Phase fatigue escalation
    if (state.phaseFloor && state.phaseFloor.shareEma < (state.phaseFloor.collapseThreshold || 0.05)) {
      S.phaseFatigueBeats = (S.phaseFatigueBeats || 0) + ST.ORCHESTRATE_INTERVAL;
      if (S.phaseFatigueBeats > 75) {
        const fatigueEscalation = clamp(1.0 + (S.phaseFatigueBeats - 75) / 200, 1.0, 2.5);
        ST.rateMultipliers.phaseExemption = m.max(
          ST.rateMultipliers.phaseExemption || 1.0, fatigueEscalation);
      }
    } else {
      S.phaseFatigueBeats = m.max(0, (S.phaseFatigueBeats || 0) - ST.ORCHESTRATE_INTERVAL * 0.5);
    }

    // 15. Emit diagnostics
    safePreBoot.call(() => explainabilityBus.emit('hyper-meta-orchestration', 'both', {
      beat: S.beatCount,
      health: S.healthEma,
      systemPhase: S.systemPhase,
      exceedanceTrend: S.exceedanceTrendEma,
      phaseTrend: S.phaseTrendEma,
      rateMultipliers: Object.assign({}, ST.rateMultipliers),
      contradictionCount: ST.contradictions.length,
      axisConcentration: health.getAxisConcentration(),
      correlationFlips: corrFlips,
      topologyEntropy: S.topologyEntropyEma,
      topologyPhase: S.topologyPhase,
      crossState: S.crossState,
      attractorSimilarity: S.attractorSimilarityEma,
      attractorStabilityBeats: S.attractorStabilityBeats,
      emergenceStreak: S.emergenceStreak,
      interventionBudgetScale: S.interventionBudgetScale,
      topologyCreativity: S.topologyCreativityMultiplier,
    }));
  }

  // PUBLIC API

  function getRateMultiplier(key)        { return ST.rateMultipliers[key] || 1.0; }
  function getPhaseBoostCeiling()        { return S.phaseBoostCeiling; }
  function getP95AlphaMultiplier()       { return ST.rateMultipliers.p95Alpha || 1.0; }
  function getS0TighteningMultiplier()   { return ST.rateMultipliers.s0Tightening || 1.0; }
  function getSystemPhase()              { return S.systemPhase; }
  function getVarianceGateRelaxMultiplier() {
    return m.max(ST.rateMultipliers.varianceGateRelax || 1.0, ST.rateMultipliers.varianceGateRelaxTelemetry || 1.0);
  }
  function getTopologyCreativityMultiplier() { return S.topologyCreativityMultiplier; }
  function getTopologyPhase()            { return S.topologyPhase; }
  function getCrossState()               { return S.crossState; }

  function getSnapshot() {
    return {
      beatCount: S.beatCount,
      healthEma: S.healthEma,
      systemPhase: S.systemPhase,
      exceedanceTrendEma: S.exceedanceTrendEma,
      phaseTrendEma: S.phaseTrendEma,
      energyBalanceEma: S.energyBalanceEma,
      totalInterventionEma: S.totalInterventionEma,
      phaseBoostCeiling: S.phaseBoostCeiling,
      rateMultipliers: Object.assign({}, ST.rateMultipliers),
      controllerStats: Object.assign({}, ST.controllerStats),
      contradictions: ST.contradictions.slice(-5),
      axisConcentration: health.getAxisConcentration(),
      correlationFlips: S.lastFlipCount,
      topologyEntropy: S.topologyEntropyEma,
      topologyPhase: S.topologyPhase,
      crossState: S.crossState,
      attractorSimilarity: S.attractorSimilarityEma,
      attractorStabilityBeats: S.attractorStabilityBeats,
      emergenceStreak: S.emergenceStreak,
      interventionBudgetScale: S.interventionBudgetScale,
      topologyCreativity: S.topologyCreativityMultiplier,
      trajectory: ST.trajectory.slice(-10),
    };
  }

  function reset() {
    const axes = Object.keys(ST.axisExceedanceCounts);
    for (let i = 0; i < axes.length; i++) ST.axisExceedanceCounts[axes[i]] = 0;
    const prs = Object.keys(ST.pairExceedanceCounts);
    for (let i = 0; i < prs.length; i++) ST.pairExceedanceCounts[prs[i]] = 0;
    S.attractorStabilityBeats = m.floor(S.attractorStabilityBeats * 0.5);
  }

  // SELF-REGISTRATION
  conductorIntelligence.registerRecorder('hyperMetaManager', tick);
  conductorIntelligence.registerStateProvider('hyperMetaManager', () => ({
    hyperMetaManager: getSnapshot(),
  }));
  conductorIntelligence.registerModule('hyperMetaManager', { reset }, ['section']);

  return {
    getRateMultiplier,
    getPhaseBoostCeiling,
    getP95AlphaMultiplier,
    getS0TighteningMultiplier,
    getSystemPhase,
    getVarianceGateRelaxMultiplier,
    getTopologyCreativityMultiplier,
    getTopologyPhase,
    getCrossState,
    recordExceedance: health.recordExceedance,
    getAxisConcentration: health.getAxisConcentration,
    getSnapshot,
    reset,
  };
})();
