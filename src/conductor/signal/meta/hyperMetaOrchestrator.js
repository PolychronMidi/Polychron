// hyperMetaOrchestrator.js - Hyperhypermeta master orchestrator (#17).
// Centralizes all 16 hypermeta self-calibrating controllers into a unified
// dynamic self-corrector. Every _ORCHESTRATE_INTERVAL beats, gathers state
// from all controllers and computes:
//  1. System health composite (exceedance trend, energy balance, phase health)
//  2. Cross-controller contradiction detection (beyond watchdog pair-level)
//  3. Adaptive rate multipliers that controllers query to self-scale
//  4. Global intervention budget enforcement
//  5. Controller effectiveness tracking and priority ranking
//  6. Coupling topology intelligence
//  7. Regime-topology cross-state emergence detection
//  8. Compositional trajectory memory
//  9. Attractor recognition with self-coherence scoring
//
// Incorporates R98 evolutions:
//  E1: Phase floor boost authority expansion (orchestrator-managed ceiling)
//  E3: Reconciliation gap reduction via adaptive p95 EMA alpha scaling
//  E4: Section 0 exceedance reduction via tighter initial ceiling authority
//  E5: Warmup ramp section-length EMA initialization (orchestrator tracks)
//  E6: Exceedance axis-concentration diagnostic (orchestrator emits)
//
// Coupling Topology Intelligence -- the hyperhypermetameta layer.
// Instead of treating coupling pairs individually, the orchestrator now
// perceives the ENTIRE correlation matrix as a topology and classifies its
// emergent phase. Three topology phases interact with three regime states
// to produce cross-states (emergence/locked/seeking/dampened). When the
// composition enters an "emergence" state (exploring regime + resonant
// topology), the orchestrator recognizes self-coherent pattern formation
// and reduces control authority to let the pattern express. When "locked"
// (coherent + crystallized), it increases perturbation to break stasis.
// Compositional trajectory memory tracks topology phase transitions across
// sections, detecting narrative arcs. Attractor recognition identifies
// recurring topology fingerprints as structural self-similarity.

/**
 * @typedef {Object} HyperMetaOrchestratorAPI
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
 * @type {HyperMetaOrchestratorAPI}
 */
hyperMetaOrchestrator = (() => {

  // ORCHESTRATION CONSTANTS
  const _ORCHESTRATE_INTERVAL = 25;   // analyze every N beats
  const _HEALTH_EMA_ALPHA = 0.08;     // system health EMA
  const _EFFECTIVENESS_EMA_ALPHA = 0.05;
  const _INTERVENTION_BUDGET = 0.60;  // max total intervention energy per cycle

  // SYSTEM STATE
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

  // Phase floor boost authority ceiling
  let hyperMetaOrchestratorPhaseBoostCeiling = 25.0;

  // Axis-concentration tracking
  /** @type {Record<string, number>} */
  const hyperMetaOrchestratorAxisExceedanceCounts = {};

  // Correlation trend monitoring -- track sign flips across ticks
  /** @type {Record<string, number>} previous correlation sign per pair (+1/-1/0) */
  const hyperMetaOrchestratorPrevCorrSign = {};
  let hyperMetaOrchestratorLastFlipCount = 0;

  // COUPLING TOPOLOGY INTELLIGENCE
  // Perceives the coupling matrix as a unified topology rather than
  // individual pairs. Computes entropy, classifies phase, detects
  // regime-topology cross-states, tracks trajectory, recognizes attractors.

  let hyperMetaOrchestratorTopologyEntropyEma = 0.50;
  /** @type {'crystallized' | 'resonant' | 'fluid'} */
  let hyperMetaOrchestratorTopologyPhase = 'fluid';
  /** @type {'emergence' | 'locked' | 'seeking' | 'dampened'} */
  let hyperMetaOrchestratorCrossState = 'seeking';
  let hyperMetaOrchestratorInterventionBudgetScale = 1.0;
  /** @type {Array<{ section: number, phase: string, entropy: number, crossState: string }>} */
  const hyperMetaOrchestratorTrajectory = [];
  let hyperMetaOrchestratorAttractorSimilarityEma = 0.0;
  let hyperMetaOrchestratorAttractorStabilityBeats = 0;
  /** @type {Record<string, number>} quantized correlation bucket per pair */
  const hyperMetaOrchestratorPrevFingerprint = {};
  let hyperMetaOrchestratorTopologyCreativityMultiplier = 1.0;
  let hyperMetaOrchestratorEmergenceStreak = 0;
  let hyperMetaOrchestratorCurrentSection = -1;

  // HYPERMETA TELEMETRY RECONCILIATION
  // Tracks gaps between trace P95 and controller P95 to detect telemetry lag
  /** @type {Record<string, { traceP95: number, controllerP95: number, gap: number }>} */
  const hyperMetaOrchestratorReconciliationGaps = {};
  const hyperMetaOrchestratorTrustVelocityHistory = {};

  // TELEMETRY CONSTANTS
  const _TRUST_VELOCITY_DAMPING = 0.75;
  const _PHASE_STALE_THRESHOLD = 0.15;

  // TELEMETRY RECONCILIATION FUNCTIONS

  /**
   * Update telemetry reconciliation gaps from trace summary and controller state.
   * @param {ReturnType<typeof gatherControllerState>} state
   */
  function updateTelemetryReconciliation(state) {
    // Get trace summary data if available
    const traceSummary = safePreBoot.call(() => traceSummaryData, null);
    if (!traceSummary || !traceSummary.adaptiveTelemetryReconciliation) return;

    const reconciliation = traceSummary.adaptiveTelemetryReconciliation;
    const pairs = Object.keys(reconciliation.pairs || {});

    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      const traceData = reconciliation.pairs[pair];
      const controllerData = state.pairCeiling && state.pairCeiling[pair];

      if (!traceData || !controllerData) continue;

      const gap = traceData.traceP95 - controllerData.p95Ema;
      hyperMetaOrchestratorReconciliationGaps[pair] = {
        traceP95: traceData.traceP95,
        controllerP95: controllerData.p95Ema,
        gap: gap
      };

      // E3: Adaptive p95 EMA alpha scaling when reconciliation gap is large
      if (gap > 0.20 && controllerData.activeBeats > 30) {
        // Large gap detected -- increase controller alpha to track reality faster
        hyperMetaOrchestratorRateMultipliers.p95Alpha = m.max(
          hyperMetaOrchestratorRateMultipliers.p95Alpha || 1.0,
          2.0
        );
      }
    }
  }

  /**
   * Apply trust velocity damping to stabilize system.
   * @param {ReturnType<typeof gatherControllerState>} state
   */
  function applyTrustVelocityDamping(state) {
    if (!state.watchdog) return;

    const pipelines = Object.keys(state.watchdog);
    for (let i = 0; i < pipelines.length; i++) {
      const pipeline = pipelines[i];
      const controllers = Object.keys(state.watchdog[pipeline]);

      for (let j = 0; j < controllers.length; j++) {
        const controller = controllers[j];
        const currentAttenuation = state.watchdog[pipeline][controller];

        // Track velocity history
        const key = `${pipeline}-${controller}`;
        if (!hyperMetaOrchestratorTrustVelocityHistory[key]) {
          hyperMetaOrchestratorTrustVelocityHistory[key] = [];
        }

        hyperMetaOrchestratorTrustVelocityHistory[key].push(currentAttenuation);
        if (hyperMetaOrchestratorTrustVelocityHistory[key].length > 5) {
          hyperMetaOrchestratorTrustVelocityHistory[key].shift();
        }

        // Calculate velocity (rate of change)
        const history = hyperMetaOrchestratorTrustVelocityHistory[key];
        if (history.length >= 3) {
          const recent = history.slice(-3);
          const velocity = (recent[2] - recent[0]) / 2; // smoothed velocity

          // Apply damping when velocity exceeds threshold
          if (m.abs(velocity) > 0.15) {
            // High velocity detected -- dampen the rate multiplier
            hyperMetaOrchestratorRateMultipliers.global *= _TRUST_VELOCITY_DAMPING;
          }
        }
      }
    }
  }

  /**
   * Check phase telemetry integrity and apply corrections.
   * @param {ReturnType<typeof gatherControllerState>} state
   */
  function checkPhaseTelemetryIntegrity(state) {
    const telemetryHealth = safePreBoot.call(() => telemetryHealthData, null);
    if (!telemetryHealth) return;

    const staleRate = telemetryHealth.phaseStaleRate || 0;

    if (staleRate > _PHASE_STALE_THRESHOLD) {
      // Phase telemetry integrity is compromised
      // Apply corrective measures

      // 1. Increase phase floor sensitivity to compensate for stale data
      if (state.phaseFloor) {
        hyperMetaOrchestratorPhaseBoostCeiling = clamp(
          hyperMetaOrchestratorPhaseBoostCeiling + 1.0,
          25.0, 40.0
        );
      }

      // 2. Reduce coupling gate engagement to allow more phase pairs through
      hyperMetaOrchestratorRateMultipliers.varianceGateRelax = m.max(
        hyperMetaOrchestratorRateMultipliers.varianceGateRelax || 1.0,
        1.8
      );

      // 3. Signal topology intelligence to be more permissive with phase pairs
      hyperMetaOrchestratorTopologyCreativityMultiplier = m.max(
        hyperMetaOrchestratorTopologyCreativityMultiplier,
        1.15
      );
    } else {
      // Phase telemetry is healthy -- relax corrections
      hyperMetaOrchestratorPhaseBoostCeiling = clamp(
        hyperMetaOrchestratorPhaseBoostCeiling - 0.2,
        25.0, 40.0
      );
      hyperMetaOrchestratorRateMultipliers.varianceGateRelax = m.max(
        1.0,
        (hyperMetaOrchestratorRateMultipliers.varianceGateRelax || 1.0) * 0.95
      );
    }
  }

  // CONTROLLER STATE SAMPLING

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

  // SYSTEM HEALTH

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

  // SYSTEM PHASE DETECTION

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

  // ADAPTIVE RATE MULTIPLIERS

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
      // Extend to flicker-trust when reconciliation gap is large
      const ftState = state.pairCeiling['flicker-trust'];
      if (ftState && ftState.p95Ema < 0.70 && ftState.activeBeats > 50) {
        p95AlphaMultiplier = m.max(p95AlphaMultiplier, 1.8);
      }
      // Extend to tension-flicker (new #1 tail pair)
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

  // CROSS-CONTROLLER CONTRADICTION DETECTION

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

    // Contradiction 4: Coherent regime suppresses phase coupling energy.
    // When coherent regime is present and phase share is low, the coherent
    // target scale relaxation in couplingRefreshSetup raises the bar for ALL
    // pairs, but phase pairs with weak correlations fall below the relaxed
    // target and get fewer nudges. Contradiction 1 only fires when homeostasis
    // is throttling (globalGainMultiplier < 0.7), which doesn't happen here.
    // This new contradiction detects the coherent-phase conflict directly.
    if (state.phaseFloor && state.profiler) {
      const currentRegime = state.profiler.regime || '';
      const phaseShareLow = state.phaseFloor.shareEma < 0.08;
      const isCoherentRegime = currentRegime === 'coherent';
      const homeostasisNotThrottling = !state.homeostasis || state.homeostasis.globalGainMultiplier >= 0.7;
      if (phaseShareLow && isCoherentRegime && homeostasisNotThrottling) {
        recordContradiction(
          ['phaseFloorController', 'couplingRefreshSetup'],
          'Coherent regime suppresses phase coupling via target relaxation while phase share < 0.08'
        );
        // Emit phaseExemption so downstream gain logic can boost phase pairs
        const phaseSeverity = clamp((0.08 - state.phaseFloor.shareEma) / 0.06, 0, 1);
        hyperMetaOrchestratorRateMultipliers.phaseExemption = m.max(
          hyperMetaOrchestratorRateMultipliers.phaseExemption || 1.0,
          1.0 + phaseSeverity * 1.2
        );
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

  // EFFECTIVENESS TRACKING

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

  // AXIS CONCENTRATION TRACKING (E6)

  // CORRELATION TREND MONITORING

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
    if (axes.length === 0) return { axisExceedance: Object.create(null), concentration: 0, dominantAxis: 'none' };

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

  // TOPOLOGY INTELLIGENCE FUNCTIONS

  /**
   * Compute normalized Shannon entropy of the coupling correlation matrix.
   * Measures how evenly coupling energy is distributed across pairs.
   * High entropy = balanced, diverse coupling landscape.
   * Low entropy = dominated by a few strong correlations.
   * @param {Record<string, number>} matrix - pair correlation values
   * @returns {number} normalized entropy [0, 1]
   */
  function computeTopologyEntropy(matrix) {
    const pairs = Object.keys(matrix);
    if (pairs.length < 2) return 0.5;

    // Use absolute correlation values as "energy" distribution
    let totalAbs = 0;
    const absValues = [];
    for (let i = 0; i < pairs.length; i++) {
      const v = Number(matrix[pairs[i]]);
      if (!Number.isFinite(v)) continue;
      const a = m.abs(v) + 0.001; // floor to prevent log(0)
      absValues.push(a);
      totalAbs += a;
    }
    if (absValues.length < 2 || totalAbs < 0.01) return 0.5;

    // Shannon entropy: H = -sum(p * log2(p))
    let entropy = 0;
    for (let i = 0; i < absValues.length; i++) {
      const p = absValues[i] / totalAbs;
      if (p > 0) entropy -= p * (m.log(p) / m.LN2);
    }

    // Normalize by maximum entropy (uniform distribution)
    const maxEntropy = m.log(absValues.length) / m.LN2;
    return maxEntropy > 0 ? clamp(entropy / maxEntropy, 0, 1) : 0.5;
  }

  /**
   * Classify the coupling topology phase from its entropy.
   * @param {number} normalizedEntropy [0, 1]
   * @returns {'crystallized' | 'resonant' | 'fluid'}
   */
  function classifyTopologyPhase(normalizedEntropy) {
    // Crystallized: energy concentrated in few pairs (low entropy)
    if (normalizedEntropy < 0.50) return 'crystallized';
    // Resonant: balanced structure with moderate correlations (mid entropy)
    if (normalizedEntropy < 0.72) return 'resonant';
    // Fluid: dispersed, chaotic, weak correlations (high entropy)
    return 'fluid';
  }

  /**
   * Determine the regime-topology cross-state.
   * This is the hyperhypermetameta classification: it combines the macro
   * compositional regime with the emergent topology phase to identify
   * qualitatively different system behaviors.
   *
   * emergence: exploring + resonant -- novel self-coherent patterns forming.
   *   The composition is "speaking a new language." Reduce control authority.
   * locked: coherent + crystallized -- strong correlations dominate in a
   *   stable regime. Risk of compositional stasis. Increase perturbation.
   * seeking: evolving + fluid OR any non-special combination. Normal control.
   * dampened: system is oscillating regardless of topology. Override to safety.
   *
   * @param {string} regime
   * @param {'crystallized' | 'resonant' | 'fluid'} topPhase
   * @param {'converging' | 'oscillating' | 'stabilized'} sysPhase
   * @returns {'emergence' | 'locked' | 'seeking' | 'dampened'}
   */
  function computeCrossState(regime, topPhase, sysPhase) {
    // Oscillating overrides everything -- safety first
    if (sysPhase === 'oscillating') return 'dampened';

    // Emergence: exploring regime with resonant topology
    // The composition has found structured novelty -- self-coherent patterns
    if (regime === 'exploring' && topPhase === 'resonant') return 'emergence';

    // Also emergence: evolving regime with resonant topology (approaching novelty)
    if (regime === 'evolving' && topPhase === 'resonant' && sysPhase === 'stabilized') return 'emergence';

    // Locked: coherent regime with crystallized topology -- stasis risk
    if (regime === 'coherent' && topPhase === 'crystallized') return 'locked';

    // Everything else: normal seeking behavior
    return 'seeking';
  }

  /**
   * Quantize the coupling matrix into a discrete fingerprint for
   * attractor detection. Each pair is bucketed into one of 5 categories
   * based on correlation strength and sign.
   * @param {Record<string, number>} matrix
   * @returns {Record<string, number>} quantized fingerprint (values: -2,-1,0,1,2)
   */
  function quantizeTopologyFingerprint(matrix) {
    const fp = Object.create(null);
    const pairs = Object.keys(matrix);
    for (let i = 0; i < pairs.length; i++) {
      const v = Number(matrix[pairs[i]]);
      if (!Number.isFinite(v)) { fp[pairs[i]] = 0; continue; }
      // 5 buckets: strong-neg, weak-neg, neutral, weak-pos, strong-pos
      if (v < -0.30) fp[pairs[i]] = -2;
      else if (v < -0.08) fp[pairs[i]] = -1;
      else if (v <= 0.08) fp[pairs[i]] = 0;
      else if (v <= 0.30) fp[pairs[i]] = 1;
      else fp[pairs[i]] = 2;
    }
    return fp;
  }

  /**
   * Compute similarity between two topology fingerprints.
   * Returns [0, 1] where 1 = identical topology shape.
   * @param {Record<string, number>} fpA
   * @param {Record<string, number>} fpB
   * @returns {number}
   */
  function fingerprintSimilarity(fpA, fpB) {
    const keysA = Object.keys(fpA);
    if (keysA.length === 0) return 0;
    let matches = 0;
    let total = 0;
    for (let i = 0; i < keysA.length; i++) {
      const key = keysA[i];
      if (key in fpB) {
        total++;
        if (fpA[key] === fpB[key]) matches++;
        else if (m.abs(fpA[key] - fpB[key]) === 1) matches += 0.5; // adjacent bucket
      }
    }
    return total > 0 ? matches / total : 0;
  }

  /**
   * Full topology intelligence update. Called every orchestration tick.
   * Computes entropy, classifies topology phase, detects cross-state,
   * updates attractor tracking, and sets topology-derived multipliers.
   * @param {ReturnType<typeof gatherControllerState>} state
   */
  function updateTopologyIntelligence(state) {
    if (!state.profiler || !state.profiler.couplingMatrix) return;

    const matrix = state.profiler.couplingMatrix;
    const regime = state.profiler.regime || 'initializing';

    // 1. Compute topology entropy
    const rawEntropy = computeTopologyEntropy(matrix);
    hyperMetaOrchestratorTopologyEntropyEma +=
      (rawEntropy - hyperMetaOrchestratorTopologyEntropyEma) * 0.12;

    // 2. Classify topology phase
    hyperMetaOrchestratorTopologyPhase =
      classifyTopologyPhase(hyperMetaOrchestratorTopologyEntropyEma);

    // 3. Determine regime-topology cross-state
    hyperMetaOrchestratorCrossState = computeCrossState(
      regime,
      hyperMetaOrchestratorTopologyPhase,
      hyperMetaOrchestratorSystemPhase
    );

    // 4. Track emergence streak
    if (hyperMetaOrchestratorCrossState === 'emergence') {
      hyperMetaOrchestratorEmergenceStreak++;
    } else {
      hyperMetaOrchestratorEmergenceStreak = 0;
    }

    // 5. Attractor detection via fingerprint similarity
    const fp = quantizeTopologyFingerprint(matrix);
    const prevKeys = Object.keys(hyperMetaOrchestratorPrevFingerprint);
    if (prevKeys.length > 0) {
      const similarity = fingerprintSimilarity(fp, hyperMetaOrchestratorPrevFingerprint);
      hyperMetaOrchestratorAttractorSimilarityEma +=
        (similarity - hyperMetaOrchestratorAttractorSimilarityEma) * 0.10;

      // Attractor recognized when similarity is consistently high
      if (hyperMetaOrchestratorAttractorSimilarityEma > 0.70) {
        hyperMetaOrchestratorAttractorStabilityBeats += _ORCHESTRATE_INTERVAL;
      } else {
        hyperMetaOrchestratorAttractorStabilityBeats = m.max(0,
          hyperMetaOrchestratorAttractorStabilityBeats - _ORCHESTRATE_INTERVAL * 0.5);
      }
    }
    // Update fingerprint
    const fpKeys = Object.keys(fp);
    for (let i = 0; i < fpKeys.length; i++) {
      hyperMetaOrchestratorPrevFingerprint[fpKeys[i]] = fp[fpKeys[i]];
    }

    // 6. Compute topology-derived multipliers

    // Creativity multiplier: emergence amplifies, locked suppresses
    if (hyperMetaOrchestratorCrossState === 'emergence') {
      // Emergence: reduce control, amplify creative freedom
      // Stronger effect during sustained emergence (streak) and in attractors
      const streakBonus = clamp(hyperMetaOrchestratorEmergenceStreak * 0.01, 0, 0.10);
      const attractorBonus = hyperMetaOrchestratorAttractorStabilityBeats > 50
        ? 0.05 : 0;
      hyperMetaOrchestratorTopologyCreativityMultiplier =
        clamp(1.12 + streakBonus + attractorBonus, 1.0, 1.30);
    } else if (hyperMetaOrchestratorCrossState === 'locked') {
      // Locked: increase perturbation to break crystallization
      hyperMetaOrchestratorTopologyCreativityMultiplier =
        clamp(0.85 - (hyperMetaOrchestratorAttractorStabilityBeats > 100 ? 0.05 : 0), 0.75, 1.0);
    } else if (hyperMetaOrchestratorCrossState === 'dampened') {
      // Dampened: neutral but slightly conservative
      hyperMetaOrchestratorTopologyCreativityMultiplier = 0.95;
    } else {
      // Seeking: relax toward neutral
      hyperMetaOrchestratorTopologyCreativityMultiplier +=
        (1.0 - hyperMetaOrchestratorTopologyCreativityMultiplier) * 0.15;
    }

    // Intervention budget scale: emergence reduces budget, locked increases
    if (hyperMetaOrchestratorCrossState === 'emergence') {
      hyperMetaOrchestratorInterventionBudgetScale =
        clamp(hyperMetaOrchestratorInterventionBudgetScale * 0.97, 0.40, 1.0);
    } else if (hyperMetaOrchestratorCrossState === 'locked') {
      hyperMetaOrchestratorInterventionBudgetScale =
        clamp(hyperMetaOrchestratorInterventionBudgetScale * 1.03, 0.40, 1.20);
    } else {
      hyperMetaOrchestratorInterventionBudgetScale +=
        (1.0 - hyperMetaOrchestratorInterventionBudgetScale) * 0.08;
    }

    // Store in rate multipliers for downstream consumption
    hyperMetaOrchestratorRateMultipliers.topologyCreativity =
      hyperMetaOrchestratorTopologyCreativityMultiplier;
    hyperMetaOrchestratorRateMultipliers.interventionBudget =
      _INTERVENTION_BUDGET * hyperMetaOrchestratorInterventionBudgetScale;

    // 7. Section trajectory tracking
    const sectionIdx = Number.isFinite(sectionIndex) ? sectionIndex : -1;
    if (sectionIdx !== hyperMetaOrchestratorCurrentSection && sectionIdx >= 0) {
      hyperMetaOrchestratorTrajectory.push({
        section: hyperMetaOrchestratorCurrentSection,
        phase: hyperMetaOrchestratorTopologyPhase,
        entropy: m.round(hyperMetaOrchestratorTopologyEntropyEma * 1000) / 1000,
        crossState: hyperMetaOrchestratorCrossState
      });
      // Trajectory-based perturbation: if stuck in same phase for 3+ sections
      if (hyperMetaOrchestratorTrajectory.length >= 3) {
        const recent = hyperMetaOrchestratorTrajectory.slice(-3);
        const allSamePhase = recent[0].phase === recent[1].phase &&
          recent[1].phase === recent[2].phase;
        if (allSamePhase) {
          // Compositional stasis detected -- nudge the global rate to perturb
          hyperMetaOrchestratorRateMultipliers.global *= 0.92;
        }
      }
      hyperMetaOrchestratorCurrentSection = sectionIdx;
    }
  }

  // MAIN ORCHESTRATION TICK

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

    // 8. Correlation trend monitoring -- detect simultaneous sign flips
    const corrFlips = detectCorrelationFlips(state);
    if (corrFlips >= 2) {
      hyperMetaOrchestratorRateMultipliers.global *= 0.90;
    }

    // 9. Coupling topology intelligence -- the hyperhypermetameta layer
    // Perceives the full correlation matrix as a topology, classifies its
    // emergent phase, detects regime-topology cross-states, tracks attractors,
    // and modulates all downstream controllers via topology-derived multipliers.
    updateTopologyIntelligence(state);

    // 10. Hypermeta telemetry reconciliation and trust velocity stabilization
    updateTelemetryReconciliation(state);
    applyTrustVelocityDamping(state);
    checkPhaseTelemetryIntegrity(state);

    // 11. Apply topology creativity multiplier to global rate
    // During emergence, controllers operate with more creative freedom (higher
    // ceilings, slower tightening). During locked state, controllers operate
    // more aggressively to break crystallization.
    hyperMetaOrchestratorRateMultipliers.global *= hyperMetaOrchestratorTopologyCreativityMultiplier;

    // 12. Emit diagnostics
    safePreBoot.call(() => explainabilityBus.emit('hyper-meta-orchestration', 'both', {
      beat: hyperMetaOrchestratorBeatCount,
      health: hyperMetaOrchestratorHealthEma,
      systemPhase: hyperMetaOrchestratorSystemPhase,
      exceedanceTrend: hyperMetaOrchestratorExceedanceTrendEma,
      phaseTrend: hyperMetaOrchestratorPhaseTrendEma,
      rateMultipliers: Object.assign({}, hyperMetaOrchestratorRateMultipliers),
      contradictionCount: hyperMetaOrchestratorContradictions.length,
      axisConcentration: getAxisConcentration(),
      correlationFlips: corrFlips,
      // Topology intelligence diagnostics
      topologyEntropy: hyperMetaOrchestratorTopologyEntropyEma,
      topologyPhase: hyperMetaOrchestratorTopologyPhase,
      crossState: hyperMetaOrchestratorCrossState,
      attractorSimilarity: hyperMetaOrchestratorAttractorSimilarityEma,
      attractorStabilityBeats: hyperMetaOrchestratorAttractorStabilityBeats,
      emergenceStreak: hyperMetaOrchestratorEmergenceStreak,
      interventionBudgetScale: hyperMetaOrchestratorInterventionBudgetScale,
      topologyCreativity: hyperMetaOrchestratorTopologyCreativityMultiplier
    }));
  }

  // PUBLIC API

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

  /**
   * Get the topology creativity multiplier.
   * Downstream controllers (e.g. pairGainCeilingController) apply this to
   * their tighten/relax rates. During emergence (exploring + resonant
   * topology), controllers are more permissive (> 1.0). During locked
   * (coherent + crystallized), controllers are more aggressive (< 1.0).
   * @returns {number}
   */
  function getTopologyCreativityMultiplier() {
    return hyperMetaOrchestratorTopologyCreativityMultiplier;
  }

  /**
   * Get the current topology phase.
   * @returns {'crystallized' | 'resonant' | 'fluid'}
   */
  function getTopologyPhase() {
    return hyperMetaOrchestratorTopologyPhase;
  }

  /**
   * Get the current regime-topology cross-state.
   * @returns {'emergence' | 'locked' | 'seeking' | 'dampened'}
   */
  function getCrossState() {
    return hyperMetaOrchestratorCrossState;
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
      correlationFlips: hyperMetaOrchestratorLastFlipCount,
      // Topology intelligence snapshot
      topologyEntropy: hyperMetaOrchestratorTopologyEntropyEma,
      topologyPhase: hyperMetaOrchestratorTopologyPhase,
      crossState: hyperMetaOrchestratorCrossState,
      attractorSimilarity: hyperMetaOrchestratorAttractorSimilarityEma,
      attractorStabilityBeats: hyperMetaOrchestratorAttractorStabilityBeats,
      emergenceStreak: hyperMetaOrchestratorEmergenceStreak,
      interventionBudgetScale: hyperMetaOrchestratorInterventionBudgetScale,
      topologyCreativity: hyperMetaOrchestratorTopologyCreativityMultiplier,
      trajectory: hyperMetaOrchestratorTrajectory.slice(-10)
    };
  }

  function reset() {
    // Preserve EMAs across sections (inter-section learning persists)
    // Reset per-section counters
    const axes = Object.keys(hyperMetaOrchestratorAxisExceedanceCounts);
    for (let i = 0; i < axes.length; i++) {
      hyperMetaOrchestratorAxisExceedanceCounts[axes[i]] = 0;
    }
    // Preserve topology EMAs and trajectory across sections
    // (inter-section learning is the whole point of trajectory tracking)
    // Only dampen attractor stability to allow fresh attractor detection
    hyperMetaOrchestratorAttractorStabilityBeats =
      m.floor(hyperMetaOrchestratorAttractorStabilityBeats * 0.5);
  }

  // SELF-REGISTRATION
  conductorIntelligence.registerRecorder('hyperMetaOrchestrator', tick);
  conductorIntelligence.registerStateProvider('hyperMetaOrchestrator', () => ({
    hyperMetaOrchestrator: getSnapshot()
  }));
  conductorIntelligence.registerModule('hyperMetaOrchestrator', { reset }, ['section']);

  /**
   * @typedef {Object} HyperMetaOrchestratorAPI
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

  /** @type {HyperMetaOrchestratorAPI} */
  const api = {
    getRateMultiplier,
    getPhaseBoostCeiling,
    getP95AlphaMultiplier,
    getS0TighteningMultiplier,
    getSystemPhase,
    getVarianceGateRelaxMultiplier,
    getTopologyCreativityMultiplier,
    getTopologyPhase,
    getCrossState,
    recordExceedance,
    getAxisConcentration,
    getSnapshot,
    reset
  };

  return api;
})();
