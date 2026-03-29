// hyperMetaManager state -- all mutable state and constants for the
// hyper-meta orchestrator. Sub-modules mutate this shared object;
// the main hyperMetaManager file assembles the public API on top of it.

hyperMetaManagerState = (() => {

  // ORCHESTRATION CONSTANTS
  const ORCHESTRATE_INTERVAL = 25;
  const HEALTH_EMA_ALPHA     = 0.08;
  const EFFECTIVENESS_EMA_ALPHA = 0.05;
  const INTERVENTION_BUDGET  = 0.60;

  // FAST EMA CONSTANTS -- normalization for per-beat energy proxy (density+tension deviation^2).
  // Energy range: ~0 (neutral) to ~0.15 (severe spike). Threshold at 0.05 = density ~0.67
  // or tension ~0.88 (genuine departure from neutral). Span 0.10 maps spike range to [0,1].
  // Weight 0.35 reserves fast lane for early warning; slow EMA drives sustained corrections.
  const FAST_EMA_ALPHA       = 0.22;   // ~4-beat time constant
  const FAST_EMA_THRESHOLD   = 0.05;   // energy floor before fast lane activates
  const FAST_EMA_SPAN        = 0.10;   // energy range mapped to [0,1]
  const FAST_EMA_WEIGHT      = 0.35;   // contribution weight vs slow EMA scale

  // E18 SCALE CONSTANTS -- health+exceedance combined attenuation factor.
  // Denominators/thresholds shared by hyperMetaManager and topologyIntelligence.
  const E18_HEALTH_NOMINAL   = 0.7;    // healthEma at which scale = 1.0 (full strength)
  const E18_HEALTH_FLOOR     = 0.5;    // minimum scale even at very poor health
  const E18_EXCEED_ONSET     = 0.4;    // exceedanceTrendEma above which scale reduces
  const E18_EXCEED_SLOPE     = 1.5;    // rate of reduction per unit above onset
  const E18_EXCEED_FLOOR     = 0.5;    // minimum exceedance scale

  // HEALTH GATE CONSTANTS -- thresholds for evolution health checks.
  // Centralised here so all E-number blocks reference the same values.
  const HEALTH_GATE_E5_ACCUM   = 0.75;  // E5: min healthEma before fatigue accumulates
  const HEALTH_GATE_TOPOLOGY   = 0.65;  // Topology: min healthEma for emergence budget decay
  const PHASE_FATIGUE_MAX      = 500;   // E5: ceiling for phaseFatigueBeats counter
  const TRAJECTORY_MAX         = 20;    // topology: max trajectory entries kept in memory

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
    lastRegime:            '',
    // E5: Phase fatigue escalation
    phaseFatigueBeats:     0,
    // E6: Coherent dwell suppression
    coherentRegimeBeats:   0,
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
    // E18 instantaneous scale (computed once per tick, used by multiple evolutions)
    e18Scale:              1.0,
    // E13: Long-run coherent share tracker for feedback-loop break
    // alpha=0.03 => ~33-tick window (~825 beats). Previous 0.015 was too slow;
    // thresholds (0.38, 0.55) were unreachable in typical session lengths.
    coherentShareEma:      0.285,
    // Fast EMA: per-beat signal energy proxy, ~4-beat time constant.
    // Tracks density+tension deviation from neutral every beat -- responds to
    // transient spikes within 3-5 beats vs slow EMA's ~12-tick lag.
    fastExceedanceEma:     0,
    // Normalized fast EMA signal on slow EMA scale (computed once per tick)
    fastExcNormalized:     0,
  };

  // COLLECTION STATE
  /** @type {Record<string, { effectivenessEma: number, interventionCount: number, lastContribution: number }>} */
  const controllerStats = {};
  /** @type {Record<string, number>} */
  const rateMultipliers = {
    global: 1.0,
    criticalitySnap: 1.0,
    tensionFloorProtection: 1.0,
    phaseExemption: 1.0,
    e6CoherentTightening: 1.0,
    e7TrustBoost: 1.0,
    e9DensitySmoothingRelax: 1.0,
    e9DensitySwingBoost: 1.0,
    e10TensionSuppress: 1.0,
    e10ArchFloorDrop: 1.0,
    e11SparseWindow: 0,
    e11DensityCeilingOverride: 1.0,
    e11RestBoost: 1.0,
    e12TensionFloorDrop: 0,
    e15PhraseDensityArc: 1.0,
    e15SculptSmoothRelax: 1.0,
    e17DensitySurge: 1.0,
    e17SmoothingTighten: 1.0,
    e19CrossModScale: 1.0,
    e20AttenuatorBias: 1.0,
    e21FlickerAmplitudeCap: 1.0,
    e22SnapSoften: 1.0,
    e23RestPressureBoost: 1.0,
    dimExpanderCeilingFloor: 1.0,
    p95Alpha: 1.0,
    s0Tightening: 1.0,
    varianceGateRelax: 1.0,
    varianceGateRelaxTelemetry: 1.0,
    entropyRegulator: 1.0,
    phasePairCeilingRelax: 1.0
  };
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
    HEALTH_GATE_E5_ACCUM,
    HEALTH_GATE_TOPOLOGY,
    PHASE_FATIGUE_MAX,
    TRAJECTORY_MAX,
    FAST_EMA_ALPHA,
    FAST_EMA_THRESHOLD,
    FAST_EMA_SPAN,
    FAST_EMA_WEIGHT,
    E18_HEALTH_NOMINAL,
    E18_HEALTH_FLOOR,
    E18_EXCEED_ONSET,
    E18_EXCEED_SLOPE,
    E18_EXCEED_FLOOR,
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
