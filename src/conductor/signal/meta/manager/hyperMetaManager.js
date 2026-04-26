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
moduleLifecycle.declare({
  name: 'hyperMetaManager',
  subsystem: 'conductor',
  // Top-of-init touches hyperMetaManagerState (assignment to S/ST). systemHealth
  // / contradictions / topologyIntelligence / conductorIntelligence /
  // signalReader are all referenced inside tick() and other handlers called
  // post-boot -- they don't need to gate this module's instantiation.
  deps: ['hyperMetaManagerState'],
  provides: ['hyperMetaManager'],
  init: (deps) => {
  const ST     = deps.hyperMetaManagerState;
  const S      = ST.S;
  const health = hyperMetaManagerHealth;
  const contra = hyperMetaManagerContradictions;
  const topo   = hyperMetaManagerTopology;
  const telem  = hyperMetaManagerTelemetry;
  const evo    = hyperMetaManagerEvolutions;

  // MAIN ORCHESTRATION TICK

  function tick(ctx) {
    if (ctx && ctx.layer === 'L2') return;
    S.beatCount++;

    // Fast EMA: runs every beat, not just on orchestration ticks.
    // Proxy signal = squared deviation of density+tension from their neutral points,
    // same energy formula as criticalityEngine. Time constant ~4 beats.
    // Used alongside the slow exceedanceTrendEma (~12-tick lag) to give
    // the system early warning of transient spikes before they compound.
    {
      const fd = signalReader.density();
      const ft = signalReader.tension();
      const fEnergy = (fd - 0.6) * (fd - 0.6) + (ft - 0.95) * (ft - 0.95);
      S.fastExceedanceEma += (fEnergy - S.fastExceedanceEma) * ST.FAST_EMA_ALPHA;
    }

    if (S.beatCount % ST.ORCHESTRATE_INTERVAL !== 0) return;

    const healthBefore = S.healthEma;
    const state = health.gatherControllerState();

    // 1. System health (with reconvergence acceleration on structural shifts)
    const rawHealth = health.computeSystemHealth(state);
    reconvergenceAccelerator.recordInput(rawHealth);
    const healthAlpha = ST.HEALTH_EMA_ALPHA * reconvergenceAccelerator.getAlphaMultiplier();
    S.healthEma += (rawHealth - S.healthEma) * clamp(healthAlpha, ST.HEALTH_EMA_ALPHA, 0.4);

    // Regime-adaptive alpha: spike on regime transitions to snap to new operating point
    const regimeForAlpha = state.profiler ? state.profiler.regime : null;
    if (regimeForAlpha && S.lastRegime && regimeForAlpha !== S.lastRegime) {
      S.regimeTransitionAlphaBoost = 3.0;
    }
    S.lastRegime = regimeForAlpha || S.lastRegime;
    if (S.regimeTransitionAlphaBoost > 1.0) S.regimeTransitionAlphaBoost *= 0.88;
    if (S.regimeTransitionAlphaBoost < 1.05) S.regimeTransitionAlphaBoost = 1.0;

    // 2. Exceedance trend (with regime-adaptive alpha)
    const adaptiveAlpha = ST.HEALTH_EMA_ALPHA * clamp(S.regimeTransitionAlphaBoost, 1.0, 3.0);
    if (state.pairCeiling) {
      const pairs = Object.keys(state.pairCeiling);
      let total = 0;
      for (let i = 0; i < pairs.length; i++) total += state.pairCeiling[pairs[i]].exceedanceEma;
      S.exceedanceTrendEma += (total - S.exceedanceTrendEma) * adaptiveAlpha;
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

    // 8. Correlation flips -- dampen on multi-axis oscillation.
    // E24: Scale damping continuously by exceedance rather than binary >=2 trigger.
    // Low exceedance: 1 flip = mild 0.97x, 2+ = 0.94x. High exceedance: same
    // flip counts trigger stronger 0.90x / 0.82x dampening. Self-correcting.
    const corrFlips = health.detectCorrelationFlips(state);
    if (corrFlips >= 1) {
      // Fast EMA blend: normalize fast EMA to exceedanceTrendEma scale (0.35x weight).
      // Correlation flips are short-lived -- early detection lets damping engage within
      // the same episode rather than several ticks later.
      const e24FastRescaled = ST.FAST_EMA_WEIGHT > 0 ? S.fastExcNormalized / ST.FAST_EMA_WEIGHT : 0;
      const e24Exceedance = m.max(S.exceedanceTrendEma, e24FastRescaled);
      const e24ExceedanceWeight = clamp(1.0 + e24Exceedance * 1.5, 1.0, 2.5);
      const e24FlipDampen = clamp(1.0 - corrFlips * 0.03 * e24ExceedanceWeight, 0.70, 0.99);
      ST.rateMultipliers.global *= e24FlipDampen;
    }

    // 9. Topology intelligence
    topo.update(state);

    // 10. Telemetry reconciliation & trust velocity
    telem.updateReconciliation(state);
    telem.applyTrustVelocityDamping(state);
    telem.checkPhaseTelemetryIntegrity(state);

    // 10b. Feedback loop correlation shuffler
    correlationShuffler.tick();

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
        ((ST.rateMultipliers.criticalitySnap) - 1.0) * 0.8;
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

    // E18 scale -- computed once per tick, stored in S for use by all evolutions
    // and by topologyIntelligence (which reads S directly). Eliminates duplication
    // across E1/E4/E5/E7/E9/E11/E12/E13 and topology health gate.
    // Attenuation only (max 1.0): never amplifies above calibrated values.
    // Range: 0.5x (very unhealthy/high exceedance) to 1.0x (healthy = full strength).
    {
      const e18HealthScale = clamp(S.healthEma / ST.E18_HEALTH_NOMINAL, ST.E18_HEALTH_FLOOR, 1.0);
      const e18ExceedanceScale = clamp(
        1.0 - m.max(0, S.exceedanceTrendEma - ST.E18_EXCEED_ONSET) * ST.E18_EXCEED_SLOPE,
        ST.E18_EXCEED_FLOOR, 1.0);
      S.e18Scale = e18HealthScale * e18ExceedanceScale;
    }
    const e18Scale = S.e18Scale; // local alias for readability throughout tick
    // Smoothed e18Scale for amplifying gates (E1/E4/E5/E7): exponential ramp prevents
    // instant coefficient drops when health/exceedance fluctuates. Alpha 0.15 = ~6 tick
    // time constant (~150 beats). Raw e18Scale used for E9/E11/E13 (brief pulses).
    S.e18ScaleEma += (e18Scale - S.e18ScaleEma) * 0.15;

    // Fast EMA normalized signal -- computed once per tick, stored in S.
    // Maps fastExceedanceEma (energy scale) onto slow EMA scale for blending.
    // Used by E21, E23, E24 -- single computation, no duplication.
    S.fastExcNormalized = clamp(
      (S.fastExceedanceEma - ST.FAST_EMA_THRESHOLD) / ST.FAST_EMA_SPAN, 0, 1) * ST.FAST_EMA_WEIGHT;

    // 14. Evolutions orchestration (E1-E13, E18-E21, E23)
    evo.applyEvolutions(state, e18Scale);

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

  const GLOBAL_MULTIPLIER_FLOOR = 0.65;

  function getRateMultiplier(key) {
    const val = ST.rateMultipliers[key];
    if (val === undefined) { ST.rateMultipliers[key] = 1.0; return 1.0; }
    if (key === 'global' && val < GLOBAL_MULTIPLIER_FLOOR) return GLOBAL_MULTIPLIER_FLOOR;
    return val;
  }
  function getPhaseBoostCeiling()        { return S.phaseBoostCeiling; }
  function getP95AlphaMultiplier()       { return ST.rateMultipliers.p95Alpha; }
  function getS0TighteningMultiplier()   { return ST.rateMultipliers.s0Tightening; }
  function getSystemPhase()              { return S.systemPhase; }
  function getVarianceGateRelaxMultiplier() {
    return m.max(ST.rateMultipliers.varianceGateRelax, ST.rateMultipliers.varianceGateRelaxTelemetry);
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
  },
});
