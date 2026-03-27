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


    // E6: Coherent dwell suppression via pair ceiling tightening
    const currentRegime = state.profiler ? state.profiler.regime : '';
    if (currentRegime === 'coherent') {
      S.coherentRegimeBeats += ST.ORCHESTRATE_INTERVAL;
      if (S.coherentRegimeBeats > 30) {
        const dwellExcess = S.coherentRegimeBeats - 30;
        const tightenAmount = clamp(dwellExcess / 75, 0, 0.4);
        ST.rateMultipliers.e6CoherentTightening = clamp(1.0 - tightenAmount, 0.60, 1.0);
      }
    } else {
      S.coherentRegimeBeats = 0;
      ST.rateMultipliers.e6CoherentTightening = 1.0;
    }

    // E7: Trust axis rebalancing via entropyRegulator boost
    let trustShare = 0;
    try {
      const axisEnergyShare = safePreBoot.call(() => pipelineCouplingManager.getAxisEnergyShare(), null);
      trustShare = (axisEnergyShare && axisEnergyShare.shares && axisEnergyShare.shares.trust) || 0;
    } catch {
      trustShare = 0;
    }
    if (trustShare > 0 && trustShare < 0.07) {
      const trustDeficit = 0.07 - trustShare;
      ST.rateMultipliers.e7TrustBoost = 1.0 + trustDeficit * 5.0;
    } else {
      ST.rateMultipliers.e7TrustBoost = m.max(1.0, (ST.rateMultipliers.e7TrustBoost || 1.0) * 0.9);
    }


    // E9: Density breathing windows. At phrase boundaries, temporarily
    // reduce density smoothing and widen the density floor/ceiling gap,
    // letting the raw target signal through with less EMA filtering.
    // This creates structural breathing room at phrase transitions.
    // Acts on conductor config pathway, not on pair ceilings (avoids E6).
    {
      let phraseIdx = -1;
      try { phraseIdx = safePreBoot.call(() => timeStream.getPosition('phrase'), -1) || -1; } catch { void 0; }
      if (phraseIdx >= 0 && phraseIdx !== S.e9LastPhraseIndex) {
        S.e9LastPhraseIndex = phraseIdx;
        S.e9BreathingCountdown = 4;
      }
      if (S.e9BreathingCountdown > 0) {
        S.e9BreathingCountdown--;
        // Smoothing relax: 1.0 = normal, >1.0 = reduce smoothing coefficient
        // downstream: effective smoothing = base / e9DensitySmoothingRelax
        ST.rateMultipliers.e9DensitySmoothingRelax = 1.5;
        // Swing boost: widen density bounds temporarily
        ST.rateMultipliers.e9DensitySwingBoost = 1.2;
      } else {
        // Decay toward neutral
        ST.rateMultipliers.e9DensitySmoothingRelax = m.max(1.0,
          (ST.rateMultipliers.e9DensitySmoothingRelax || 1.0) * 0.85);
        ST.rateMultipliers.e9DensitySwingBoost = m.max(1.0,
          (ST.rateMultipliers.e9DensitySwingBoost || 1.0) * 0.90);
      }
    }

    // E10: Tension release cycle. Break the flat-density -> tension-boost
    // feedback loop. When density is flat and we are at a phrase trough,
    // suppress the tension bias, allowing genuine tension dips.
    // Acts on tension bias pathway, not ceilings.
    // NOTE: arch floor drop removed after R2 showed tension-flicker
    // exceedance -- abrupt floor changes create coupling discontinuities.
    // Only the tension bias suppression remains (gentler pathway).
    {
      let phraseProgress = 0;
      try { phraseProgress = clamp(safePreBoot.call(() => timeStream.compoundProgress('phrase'), 0) || 0, 0, 1); } catch { void 0; }
      // Phrase troughs: second half of phrase is the natural descent
      const inPhraseTrough = phraseProgress > 0.55;
      // Check if density is flat via wave analyzer
      const densityWaveFlat = safePreBoot.call(() => {
        const wp = densityWaveAnalyzer.getWaveProfile();
        return wp && wp.isFlat;
      }, false);
      if (inPhraseTrough && densityWaveFlat) {
        S.e10ReleaseCooldown = 3;
        // Tension suppression: < 1.0 tells densityWaveAnalyzer to suppress
        // its tension boost instead of amplifying
        ST.rateMultipliers.e10TensionSuppress = 0.7;
      } else if (S.e10ReleaseCooldown > 0) {
        S.e10ReleaseCooldown--;
      } else {
        ST.rateMultipliers.e10TensionSuppress = m.min(1.0,
          (ST.rateMultipliers.e10TensionSuppress || 1.0) * 1.15);
      }
      ST.rateMultipliers.e10ArchFloorDrop = 0;
    }

    // E11: Structural sparse windows. At phrase boundaries, emit a sparse
    // window signal that forces multi-beat low-density passages. This
    // creates perceptible breathing that single-beat rests cannot achieve.
    // Acts on rest sync probability and density ceiling, not pair ceilings.
    {
      let phraseIdx = -1;
      try { phraseIdx = safePreBoot.call(() => timeStream.getPosition('phrase'), -1) || -1; } catch { void 0; }
      let phraseProgress = 0;
      try { phraseProgress = clamp(safePreBoot.call(() => timeStream.compoundProgress('phrase'), 0) || 0, 0, 1); } catch { void 0; }
      // Sparse window at phrase wrap: last 5% of phrase
      const atPhraseEnd = phraseProgress > 0.95;
      // Also at phrase start: first 3% after S0
      const atPhraseStart = phraseProgress < 0.03 && phraseIdx > 0;
      if (atPhraseEnd || atPhraseStart) {
        S.e11SparseCountdown = 2;
        ST.rateMultipliers.e11SparseWindow = 1.0;
        // Density ceiling suppression during sparse window (gentle)
        ST.rateMultipliers.e11DensityCeilingOverride = 0.65;
        // Rest probability boost
        ST.rateMultipliers.e11RestBoost = 2.0;
      } else if (S.e11SparseCountdown > 0) {
        S.e11SparseCountdown--;
        ST.rateMultipliers.e11SparseWindow = 1.0;
        ST.rateMultipliers.e11DensityCeilingOverride = clamp(0.65 + (2 - S.e11SparseCountdown) * 0.15, 0.65, 0.95);
        ST.rateMultipliers.e11RestBoost = m.max(1.2, 2.0 - (2 - S.e11SparseCountdown) * 0.4);
      } else {
        ST.rateMultipliers.e11SparseWindow = 0;
        ST.rateMultipliers.e11DensityCeilingOverride = 1.0;
        ST.rateMultipliers.e11RestBoost = 1.0;
      }
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
