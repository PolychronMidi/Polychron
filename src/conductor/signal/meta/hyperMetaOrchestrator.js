// hyperMetaOrchestrator.js - Hyperhypermeta master orchestrator (#17).
// Centralizes all 16 hypermeta self-calibrating controllers into a unified
// dynamic self-corrector. Every _ORCHESTRATE_INTERVAL beats, gathers state
// from all controllers and computes:
//   1. System health composite (exceedance trend, energy balance, phase health)
//   2. Cross-controller contradiction detection (beyond watchdog pair-level)
//   3. Adaptive rate multipliers that controllers query to self-scale
//   4. Global intervention budget enforcement
//   5. Controller effectiveness tracking and priority ranking
//
// Incorporates R98 evolutions:
//   E1: Phase floor boost authority expansion (orchestrator-managed ceiling)
//   E3: Reconciliation gap reduction via adaptive p95 EMA alpha scaling
//   E4: Section 0 exceedance reduction via tighter initial ceiling authority
//   E5: Warmup ramp section-length EMA initialization (orchestrator tracks)
//   E6: Exceedance axis-concentration diagnostic (orchestrator emits)

hyperMetaOrchestrator = (() => {

  // ===== ORCHESTRATION CONSTANTS =====
  const _ORCHESTRATE_INTERVAL = 25;   // analyze every N beats
  const _HEALTH_EMA_ALPHA = 0.08;     // system health EMA
  const _EFFECTIVENESS_EMA_ALPHA = 0.05;
  const _INTERVENTION_BUDGET = 0.60;  // max total intervention energy per cycle

  // ===== SYSTEM STATE =====
  let hyperMetaOrchestratorBeatCount = 0;
  let hyperMetaOrchestratorHealthEma = 0.7;    // [0,1] where 1 = perfect health
  let hyperMetaOrchestratorExceedanceTrendEma = 0;
  let hyperMetaOrchestratorPhaseTrendEma = 0.1667;
  const hyperMetaOrchestratorEnergyBalanceEma = 0.5;
  const hyperMetaOrchestratorTotalInterventionEma = 0;
  /** @type {'converging' | 'oscillating' | 'stabilized'} */
  let hyperMetaOrchestratorSystemPhase = 'converging';

  // Per-controller effectiveness tracking
  /** @type {Record<string, { effectivenessEma: number, interventionCount: number, lastContribution: number }>} */
  const hyperMetaOrchestratorControllerStats = {};

  // Adaptive rate multipliers that downstream controllers query
  /** @type {Record<string, number>} */
  const hyperMetaOrchestratorRateMultipliers = {};

  // Cross-controller contradiction log
  /** @type {Array<{ beat: number, controllers: string[], description: string }>} */
  const hyperMetaOrchestratorContradictions = [];
  const _MAX_CONTRADICTIONS = 20;

  // Phase floor boost authority ceiling (E1)
  let hyperMetaOrchestratorPhaseBoostCeiling = 25.0;

  // Axis-concentration tracking (E6)
  /** @type {Record<string, number>} */
  const hyperMetaOrchestratorAxisExceedanceCounts = {};

  // R2 E5: Correlation trend monitoring -- track sign flips across ticks
  /** @type {Record<string, number>} previous correlation sign per pair (+1/-1/0) */
  const hyperMetaOrchestratorPrevCorrSign = {};
  let hyperMetaOrchestratorLastFlipCount = 0;

  // ===== CONTROLLER STATE SAMPLING =====

  /**
   * Gather snapshots from all queryable controllers.
   * @returns {{ phaseFloor: any, pairCeiling: any, warmupRamp: any, watchdog: any, homeostasis: any, registry: any, profiler: any }}
   */
  function gatherControllerState() {
    const phaseFloor = safePreBoot.call(() => phaseFloorController.getSnapshot(), null);
    const pairCeiling = safePreBoot.call(() => pairGainCeilingController.getSnapshot(), null);
    const warmupRamp = safePreBoot.call(() => warmupRampController.getSnapshot(), null);
    const watchdog = safePreBoot.call(() => conductorMetaWatchdog.getSnapshot(), null);
    const homeostasis = safePreBoot.call(() => couplingHomeostasis.getState(), null);
    const registry = safePreBoot.call(() => metaControllerRegistry.getSnapshot(), null);
    const profiler = safePreBoot.call(() => systemDynamicsProfiler.getSnapshot(), null);
    return { phaseFloor, pairCeiling, warmupRamp, watchdog, homeostasis, registry, profiler };
  }

  // ===== SYSTEM HEALTH =====

  /**
   * Compute composite system health from controller snapshots.
   * Health is a [0,1] score: 1 = all controllers converged, no exceedance,
   * balanced energy. 0 = total chaos.
   * @param {ReturnType<typeof gatherControllerState>} state
   * @returns {number}
   */
  function computeSystemHealth(state) {
    let health = 1.0;

    // Phase health: penalize collapsed phase share
    if (state.phaseFloor) {
      const phaseShare = state.phaseFloor.shareEma;
      const phasePenalty = clamp((0.10 - phaseShare) / 0.10, 0, 1); // penalty when <10%
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
      const exceedancePenalty = clamp((maxP95 - 0.80) / 0.15, 0, 1);
      health -= exceedancePenalty * 0.30;
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

  // ===== SYSTEM PHASE DETECTION =====

  /**
   * Classify the system's current macro phase.
   * @returns {'converging' | 'oscillating' | 'stabilized'}
   */
  function classifySystemPhase() {
    const healthDelta = m.abs(hyperMetaOrchestratorHealthEma - 0.7);
    const exceedanceTrend = hyperMetaOrchestratorExceedanceTrendEma;

    if (hyperMetaOrchestratorHealthEma > 0.80 && exceedanceTrend < 0.05) {
      return 'stabilized';
    }
    if (hyperMetaOrchestratorTotalInterventionEma > _INTERVENTION_BUDGET * 0.8 && healthDelta > 0.15) {
      return 'oscillating';
    }
    return 'converging';
  }

  // ===== ADAPTIVE RATE MULTIPLIERS =====

  /**
   * Compute rate multipliers that downstream controllers query.
   * When system is oscillating, reduce all rates. When stabilized, relax rates.
   * When converging, use baseline rates.
   * @param {ReturnType<typeof gatherControllerState>} state
   */
  function updateRateMultipliers(state) {
    let globalMultiplier = 1.0;

    if (hyperMetaOrchestratorSystemPhase === 'oscillating') {
      // System is oscillating: dampen all controllers
      globalMultiplier = 0.5;
    } else if (hyperMetaOrchestratorSystemPhase === 'stabilized') {
      // System is stable: relax rates (allow faster convergence on minor issues)
      globalMultiplier = 1.3;
    }

    // E1: Phase floor boost authority expansion
    // When phase is chronically collapsed and system isn't oscillating,
    // increase the ceiling the phaseFloorController is allowed to boost to
    if (state.phaseFloor && state.phaseFloor.shareEma < 0.05) {
      if (hyperMetaOrchestratorSystemPhase !== 'oscillating') {
        hyperMetaOrchestratorPhaseBoostCeiling = clamp(
          hyperMetaOrchestratorPhaseBoostCeiling + 0.5,
          25.0, 35.0
        );
      }
    } else {
      // Phase healthy: relax ceiling back down
      hyperMetaOrchestratorPhaseBoostCeiling = clamp(
        hyperMetaOrchestratorPhaseBoostCeiling - 0.2,
        25.0, 35.0
      );
    }

    // E3: Reconciliation gap reduction
    // When reconciliation gap is large (controller p95 << trace p95),
    // increase the p95 EMA alpha so controller tracks reality faster
    let p95AlphaMultiplier = 1.0;
    if (state.pairCeiling) {
      const dfState = state.pairCeiling['density-flicker'];
      if (dfState && dfState.p95Ema < 0.70 && dfState.activeBeats > 50) {
        p95AlphaMultiplier = 1.8;
      } else if (dfState && dfState.p95Ema > 0.85) {
        p95AlphaMultiplier = 1.0;
      }
      // R3 E2: Extend to flicker-trust when reconciliation gap is large
      const ftState = state.pairCeiling['flicker-trust'];
      if (ftState && ftState.p95Ema < 0.70 && ftState.activeBeats > 50) {
        p95AlphaMultiplier = m.max(p95AlphaMultiplier, 1.8);
      }
      // R4 E2: Extend to tension-flicker (new #1 tail pair)
      const tfState = state.pairCeiling['tension-flicker'];
      if (tfState && tfState.p95Ema < 0.70 && tfState.activeBeats > 50) {
        p95AlphaMultiplier = m.max(p95AlphaMultiplier, 1.8);
      }
    }

    // E4: Section 0 initial ceiling tightening
    // When S0 exceedance is dominant, signal warmup + ceiling controllers to tighten
    let s0TighteningMultiplier = 1.0;
    if (state.warmupRamp && state.warmupRamp.pairs) {
      const dfWarmup = state.warmupRamp.pairs['density-flicker'];
      if (dfWarmup && dfWarmup.s0ExceedanceEma > 0.15) {
        s0TighteningMultiplier = 1.4; // tighten faster during S0
      }
    }

    // Store all multipliers
    hyperMetaOrchestratorRateMultipliers.global = globalMultiplier;
    hyperMetaOrchestratorRateMultipliers.phaseBoostCeiling = hyperMetaOrchestratorPhaseBoostCeiling;
    hyperMetaOrchestratorRateMultipliers.p95Alpha = p95AlphaMultiplier;
    hyperMetaOrchestratorRateMultipliers.s0Tightening = s0TighteningMultiplier;

    // E2 (R100): Variance gate relaxation for phase axis
    // When phase share is chronically near-zero, the variance gate is structural.
    // Relax the gate threshold to admit more phase pairs into coupling.
    let varianceGateRelaxMultiplier = 1.0;
    if (state.phaseFloor && state.phaseFloor.shareEma < 0.03) {
      // Phase share near zero -- gate is structural, relax it
      varianceGateRelaxMultiplier = clamp(
        1.0 + (0.03 - state.phaseFloor.shareEma) * 40, // up to 2.2x at share=0
        1.0, 2.5
      );
    }
    hyperMetaOrchestratorRateMultipliers.varianceGateRelax = varianceGateRelaxMultiplier;

    // Per-controller multipliers (effectiveness-weighted)
    const controllerNames = Object.keys(hyperMetaOrchestratorControllerStats);
    for (let i = 0; i < controllerNames.length; i++) {
      const name = controllerNames[i];
      const stats = hyperMetaOrchestratorControllerStats[name];
      // More effective controllers get slightly higher rate ceiling
      const effectivenessBoost = clamp(stats.effectivenessEma * 0.3, 0, 0.15);
      hyperMetaOrchestratorRateMultipliers[name] = globalMultiplier + effectivenessBoost;
    }
  }

  // ===== CROSS-CONTROLLER CONTRADICTION DETECTION =====

  /**
   * Detect contradictions that the watchdog might miss:
   * - phaseFloorController boosting while homeostasis throttling
   * - pairGainCeilingController tightening while warmupRampController shortening ramps
   * - Multiple controllers competing for the same energy budget
   * @param {ReturnType<typeof gatherControllerState>} state
   */
  function detectContradictions(state) {
    // Contradiction 1: Phase floor boosting while homeostasis is throttling
    if (state.phaseFloor && state.homeostasis) {
      const phaseActive = state.phaseFloor.shareEma < state.phaseFloor.collapseThreshold;
      const throttling = state.homeostasis.globalGainMultiplier < 0.7;
      if (phaseActive && throttling) {
        recordContradiction(
          ['phaseFloorController', 'couplingHomeostasis'],
          'Phase floor boosting while homeostasis throttling global gain'
        );
        // Resolution: temporarily exempt phase axis from homeostasis throttle
        hyperMetaOrchestratorRateMultipliers.phaseExemption = 1.5;
      }
    }

    // Contradiction 2: Ceiling tightening on a pair while warmup shortening ramp on same pair
    if (state.pairCeiling && state.warmupRamp && state.warmupRamp.pairs) {
      const pairs = Object.keys(state.pairCeiling);
      for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        const ceilState = state.pairCeiling[pair];
        const warmState = state.warmupRamp.pairs[pair];
        if (!ceilState || !warmState) continue;

        // Ceiling is at minimum AND warmup is at minimum = both trying to clamp
        const defaults = pair === 'density-flicker'
          ? { minCeiling: 0.04, minWarmup: 6 }
          : { minCeiling: 0.05, minWarmup: 16 };

        if (ceilState.ceiling <= defaults.minCeiling * 1.2 &&
            warmState.lastWarmupBeats <= defaults.minWarmup * 1.2) {
          recordContradiction(
            ['pairGainCeilingController', 'warmupRampController'],
            'Both ceiling and warmup at minimum for ' + pair + ' -- may cause oscillation'
          );
          // E5 (R100): Resolution -- relax the ceiling slightly since warmup is already minimal
          hyperMetaOrchestratorRateMultipliers['ceilingRelax_' + pair] = 1.3;
        } else {
          // Clear relaxation when contradiction resolves
          hyperMetaOrchestratorRateMultipliers['ceilingRelax_' + pair] = 1.0;
        }
      }
    }

    // E5 (R100) Contradiction 3: Phase floor boosting while pair ceiling tightening on phase pairs
    // When phaseFloorController is actively boosting phase energy but pairGainCeilingController
    // is tightening phase-related pairs, the system fights itself
    if (state.phaseFloor && state.pairCeiling) {
      const phaseActive = state.phaseFloor.shareEma < state.phaseFloor.lowShareThreshold;
      const ftState = state.pairCeiling['flicker-trust'];
      if (phaseActive && ftState && ftState.ceiling < 0.08) {
        recordContradiction(
          ['phaseFloorController', 'pairGainCeilingController'],
          'Phase floor boosting while flicker-trust ceiling very tight -- energy conflict'
        );
        // Resolution: ease ceiling pressure on phase-related pairs
        hyperMetaOrchestratorRateMultipliers.phasePairCeilingRelax = 1.4;
      } else {
        hyperMetaOrchestratorRateMultipliers.phasePairCeilingRelax = 1.0;
      }
    }
  }

  /**
   * @param {string[]} controllers
   * @param {string} description
   */
  function recordContradiction(controllers, description) {
    hyperMetaOrchestratorContradictions.push({
      beat: hyperMetaOrchestratorBeatCount,
      controllers,
      description
    });
    if (hyperMetaOrchestratorContradictions.length > _MAX_CONTRADICTIONS) {
      hyperMetaOrchestratorContradictions.shift();
    }
    safePreBoot.call(() => explainabilityBus.emit('hyper-meta-contradiction', 'both', {
      beat: hyperMetaOrchestratorBeatCount,
      controllers,
      description
    }));
  }

  // ===== EFFECTIVENESS TRACKING =====

  /**
   * Track effectiveness of each controller: did their intervention improve health?
   * @param {number} healthBefore
   * @param {number} healthAfter
   * @param {ReturnType<typeof gatherControllerState>} state
   */
  function updateEffectiveness(healthBefore, healthAfter, state) {
    const improvement = healthAfter - healthBefore;

    // Track phaseFloorController
    if (state.phaseFloor && state.phaseFloor.beatCount > 0) {
      updateControllerEffectiveness('phaseFloorController',
        state.phaseFloor.shareEma > state.phaseFloor.collapseThreshold ? 0.3 : -0.1);
    }

    // Track pairGainCeilingController
    if (state.pairCeiling) {
      const pairs = Object.keys(state.pairCeiling);
      let avgP95 = 0;
      for (let i = 0; i < pairs.length; i++) {
        avgP95 += state.pairCeiling[pairs[i]].p95Ema;
      }
      if (pairs.length > 0) avgP95 /= pairs.length;
      updateControllerEffectiveness('pairGainCeilingController',
        avgP95 < 0.85 ? 0.2 : -0.05);
    }

    // Track overall health improvement
    updateControllerEffectiveness('system', improvement);
  }

  /**
   * @param {string} name
   * @param {number} contribution
   */
  function updateControllerEffectiveness(name, contribution) {
    if (!hyperMetaOrchestratorControllerStats[name]) {
      hyperMetaOrchestratorControllerStats[name] = {
        effectivenessEma: 0.5,
        interventionCount: 0,
        lastContribution: 0
      };
    }
    const stats = hyperMetaOrchestratorControllerStats[name];
    stats.effectivenessEma += (clamp(contribution + 0.5, 0, 1) - stats.effectivenessEma) * _EFFECTIVENESS_EMA_ALPHA;
    stats.interventionCount++;
    stats.lastContribution = contribution;
  }

  // ===== AXIS CONCENTRATION TRACKING (E6) =====

  // ===== R2 E5: CORRELATION TREND MONITORING =====

  /**
   * Detect simultaneous sign flips in the coupling correlation matrix.
   * When >= 3 pairs flip sign in the same orchestration window, dampen
   * global rate by 10% to prevent multi-axis oscillation.
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
      const prev = hyperMetaOrchestratorPrevCorrSign[pair];

      if (prev !== undefined && prev !== 0 && sign !== 0 && prev !== sign) {
        flipCount++;
      }
      hyperMetaOrchestratorPrevCorrSign[pair] = sign;
    }

    hyperMetaOrchestratorLastFlipCount = flipCount;
    return flipCount;
  }

  /**
   * Track exceedance per axis for concentration diagnostic.
   * @param {string} pair - pair key like 'density-flicker'
   */
  function recordExceedance(pair) {
    const axes = pair.split('-');
    for (let i = 0; i < axes.length; i++) {
      hyperMetaOrchestratorAxisExceedanceCounts[axes[i]] =
        (hyperMetaOrchestratorAxisExceedanceCounts[axes[i]] || 0) + 1;
    }
  }

  /**
   * Get axis exceedance concentration diagnostic (E6).
   * Returns axis names sorted by exceedance count and concentration ratio.
   * @returns {{ axisExceedance: Record<string, number>, concentration: number, dominantAxis: string }}
   */
  function getAxisConcentration() {
    const axes = Object.keys(hyperMetaOrchestratorAxisExceedanceCounts);
    if (axes.length === 0) return { axisExceedance: {}, concentration: 0, dominantAxis: 'none' };

    let total = 0;
    let maxCount = 0;
    let dominantAxis = axes[0];
    for (let i = 0; i < axes.length; i++) {
      const count = hyperMetaOrchestratorAxisExceedanceCounts[axes[i]];
      total += count;
      if (count > maxCount) {
        maxCount = count;
        dominantAxis = axes[i];
      }
    }

    return {
      axisExceedance: Object.assign({}, hyperMetaOrchestratorAxisExceedanceCounts),
      concentration: total > 0 ? maxCount / total : 0,
      dominantAxis
    };
  }

  // ===== MAIN ORCHESTRATION TICK =====

  function tick() {
    hyperMetaOrchestratorBeatCount++;

    if (hyperMetaOrchestratorBeatCount % _ORCHESTRATE_INTERVAL !== 0) return;

    const healthBefore = hyperMetaOrchestratorHealthEma;
    const state = gatherControllerState();

    // 1. Compute system health
    const health = computeSystemHealth(state);
    hyperMetaOrchestratorHealthEma += (health - hyperMetaOrchestratorHealthEma) * _HEALTH_EMA_ALPHA;

    // 2. Detect exceedance trend
    if (state.pairCeiling) {
      const pairs = Object.keys(state.pairCeiling);
      let totalExceedance = 0;
      for (let i = 0; i < pairs.length; i++) {
        totalExceedance += state.pairCeiling[pairs[i]].exceedanceEma || 0;
      }
      hyperMetaOrchestratorExceedanceTrendEma +=
        (totalExceedance - hyperMetaOrchestratorExceedanceTrendEma) * _HEALTH_EMA_ALPHA;
    }

    // 3. Track phase health trend
    if (state.phaseFloor) {
      hyperMetaOrchestratorPhaseTrendEma +=
        (state.phaseFloor.shareEma - hyperMetaOrchestratorPhaseTrendEma) * _HEALTH_EMA_ALPHA;
    }

    // 4. Classify system phase
    hyperMetaOrchestratorSystemPhase = classifySystemPhase();

    // 5. Update rate multipliers (includes E1, E3, E4)
    updateRateMultipliers(state);

    // 6. Detect cross-controller contradictions
    detectContradictions(state);

    // 7. Update effectiveness tracking
    updateEffectiveness(healthBefore, hyperMetaOrchestratorHealthEma, state);

    // 8. R2 E5: Correlation trend monitoring -- detect simultaneous sign flips
    const corrFlips = detectCorrelationFlips(state);
    if (corrFlips >= 2) {
      hyperMetaOrchestratorRateMultipliers.global *= 0.90;
    }

    // 9. Emit diagnostics
    safePreBoot.call(() => explainabilityBus.emit('hyper-meta-orchestration', 'both', {
      beat: hyperMetaOrchestratorBeatCount,
      health: hyperMetaOrchestratorHealthEma,
      systemPhase: hyperMetaOrchestratorSystemPhase,
      exceedanceTrend: hyperMetaOrchestratorExceedanceTrendEma,
      phaseTrend: hyperMetaOrchestratorPhaseTrendEma,
      rateMultipliers: Object.assign({}, hyperMetaOrchestratorRateMultipliers),
      contradictionCount: hyperMetaOrchestratorContradictions.length,
      axisConcentration: getAxisConcentration(),
      correlationFlips: corrFlips
    }));
  }

  // ===== PUBLIC API =====

  /**
   * Get the orchestrator's rate multiplier for a controller or parameter.
   * @param {string} key - controller name or parameter key
   * @returns {number} multiplier (default 1.0)
   */
  function getRateMultiplier(key) {
    return hyperMetaOrchestratorRateMultipliers[key] || 1.0;
  }

  /**
   * Get the current phase boost ceiling (E1).
   * phaseFloorController should clamp its boost to this value.
   * @returns {number}
   */
  function getPhaseBoostCeiling() {
    return hyperMetaOrchestratorPhaseBoostCeiling;
  }

  /**
   * Get the p95 EMA alpha multiplier (E3).
   * pairGainCeilingController should multiply its _P95_EMA_ALPHA by this.
   * @returns {number}
   */
  function getP95AlphaMultiplier() {
    return hyperMetaOrchestratorRateMultipliers.p95Alpha || 1.0;
  }

  /**
   * Get the S0 tightening multiplier (E4).
   * pairGainCeilingController should apply this to its tighten rate during S0.
   * @returns {number}
   */
  function getS0TighteningMultiplier() {
    return hyperMetaOrchestratorRateMultipliers.s0Tightening || 1.0;
  }

  /**
   * Get the current system phase.
   * @returns {'converging' | 'oscillating' | 'stabilized'}
   */
  function getSystemPhase() {
    return hyperMetaOrchestratorSystemPhase;
  }

  /**
   * Get the variance gate relaxation multiplier (E2 R100).
   * systemDynamicsProfilerAnalysis multiplies the variance gate threshold by this
   * to admit more phase pairs when phase is chronically near-zero.
   * @returns {number}
   */
  function getVarianceGateRelaxMultiplier() {
    return hyperMetaOrchestratorRateMultipliers.varianceGateRelax || 1.0;
  }

  function getSnapshot() {
    return {
      beatCount: hyperMetaOrchestratorBeatCount,
      healthEma: hyperMetaOrchestratorHealthEma,
      systemPhase: hyperMetaOrchestratorSystemPhase,
      exceedanceTrendEma: hyperMetaOrchestratorExceedanceTrendEma,
      phaseTrendEma: hyperMetaOrchestratorPhaseTrendEma,
      energyBalanceEma: hyperMetaOrchestratorEnergyBalanceEma,
      totalInterventionEma: hyperMetaOrchestratorTotalInterventionEma,
      phaseBoostCeiling: hyperMetaOrchestratorPhaseBoostCeiling,
      rateMultipliers: Object.assign({}, hyperMetaOrchestratorRateMultipliers),
      controllerStats: Object.assign({}, hyperMetaOrchestratorControllerStats),
      contradictions: hyperMetaOrchestratorContradictions.slice(-5),
      axisConcentration: getAxisConcentration(),
      correlationFlips: hyperMetaOrchestratorLastFlipCount
    };
  }

  function reset() {
    // Preserve EMAs across sections (inter-section learning persists)
    // Reset per-section counters
    const axes = Object.keys(hyperMetaOrchestratorAxisExceedanceCounts);
    for (let i = 0; i < axes.length; i++) {
      hyperMetaOrchestratorAxisExceedanceCounts[axes[i]] = 0;
    }
  }

  // ===== SELF-REGISTRATION =====
  conductorIntelligence.registerRecorder('hyperMetaOrchestrator', tick);
  conductorIntelligence.registerStateProvider('hyperMetaOrchestrator', () => ({
    hyperMetaOrchestrator: getSnapshot()
  }));
  conductorIntelligence.registerModule('hyperMetaOrchestrator', { reset }, ['section']);

  return {
    getRateMultiplier,
    getPhaseBoostCeiling,
    getP95AlphaMultiplier,
    getS0TighteningMultiplier,
    getSystemPhase,
    getVarianceGateRelaxMultiplier,
    recordExceedance,
    getAxisConcentration,
    getSnapshot,
    reset
  };
})();
