// hyperMetaManager state -- all mutable state and constants for the
// hyper-meta orchestrator. Sub-modules mutate this shared object;
// the main hyperMetaManager file assembles the public API on top of it.

hyperMetaManagerState = (() => {

  // ORCHESTRATION CONSTANTS
  const ORCHESTRATE_INTERVAL = 25;
  const HEALTH_EMA_ALPHA     = 0.08;
  const EFFECTIVENESS_EMA_ALPHA = 0.05;
  const INTERVENTION_BUDGET  = 0.60;

  // TELEMETRY CONSTANTS
  const TRUST_VELOCITY_DAMPING = 0.75;
  const PHASE_STALE_THRESHOLD  = 0.15;
  const MAX_CONTRADICTIONS     = 20;

  // SYSTEM STATE (scalar)
  const S = {
    beatCount:             0,
    healthEma:             0.7,
    exceedanceTrendEma:    0,
    phaseTrendEma:         0.1667,
    energyBalanceEma:      0.5,
    totalInterventionEma:  0,
    /** @type {'converging' | 'oscillating' | 'stabilized'} */
    systemPhase:           'converging',
    phaseBoostCeiling:     25.0,
    lastFlipCount:         0,

    // Topology intelligence
    topologyEntropyEma:    0.50,
    /** @type {'crystallized' | 'resonant' | 'fluid'} */
    topologyPhase:         'fluid',
    /** @type {'emergence' | 'locked' | 'seeking' | 'dampened'} */
    crossState:            'seeking',
    interventionBudgetScale: 1.0,
    attractorSimilarityEma:  0.0,
    attractorStabilityBeats: 0,
    topologyCreativityMultiplier: 1.0,
    emergenceStreak:       0,
    currentSection:        -1,
    coherentRegimeBeats:   0,
    lastRegime:            '',
    // E9: Density breathing - phrase boundary tracking
    e9LastPhraseIndex:     -1,
    e9BreathingCountdown:  0,
    // E10: Tension release - phrase trough tracking
    e10ReleaseCooldown:    0,
    // E11/E13: Structural sparse windows (regime-aware)
    e11SparseCountdown:    0,
    // E12: Section-level tension floor relaxation (no extra state needed)
    // E18: Smoothed scale EMA for E1/E4/E5/E7 health gates (prevents instant snap)
    e18ScaleEma:           1.0,
    // E13: Long-run coherent share tracker for feedback-loop break
    coherentShareEma:      0.285,
    // Fast EMA: per-beat signal energy proxy, ~4-beat time constant (alpha=0.22).
    // Tracks density+tension deviation from neutral every beat -- responds to
    // transient spikes within 3-5 beats vs slow EMA's ~12-tick lag.
    fastExceedanceEma:     0,
  };

  // COLLECTION STATE
  /** @type {Record<string, { effectivenessEma: number, interventionCount: number, lastContribution: number }>} */
  const controllerStats = {};
  /** @type {Record<string, number>} */
  const rateMultipliers = {};
  /** @type {Array<{ beat: number, controllers: string[], description: string }>} */
  const contradictions = [];
  /** @type {Record<string, number>} */
  const axisExceedanceCounts = {};
  /** @type {Record<string, number>} */
  const pairExceedanceCounts = {};
  /** @type {Record<string, number>} */
  const prevCorrSign = {};
  /** @type {Array<{ section: number, phase: string, entropy: number, crossState: string }>} */
  const trajectory = [];
  /** @type {Record<string, number>} */
  const prevFingerprint = {};
  /** @type {Record<string, { traceP95: number, controllerP95: number, gap: number }>} */
  const reconciliationGaps = {};
  /** @type {Record<string, number[]>} */
  const trustVelocityHistory = {};

  return {
    // constants
    ORCHESTRATE_INTERVAL,
    HEALTH_EMA_ALPHA,
    EFFECTIVENESS_EMA_ALPHA,
    INTERVENTION_BUDGET,
    TRUST_VELOCITY_DAMPING,
    PHASE_STALE_THRESHOLD,
    MAX_CONTRADICTIONS,
    // scalar state
    S,
    // collection state
    controllerStats,
    rateMultipliers,
    contradictions,
    axisExceedanceCounts,
    pairExceedanceCounts,
    prevCorrSign,
    trajectory,
    prevFingerprint,
    reconciliationGaps,
    trustVelocityHistory,
  };
})();
