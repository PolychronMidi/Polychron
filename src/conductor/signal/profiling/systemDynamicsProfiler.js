// systemDynamicsProfiler.js - Phase-space trajectory analysis of the signal organism.

systemDynamicsProfiler = (() => {
  const DIM_NAMES = ['density', 'tension', 'flicker', 'entropy', 'trust', 'phase'];
  const N_DIMS = DIM_NAMES.length;
  const N_COMPOSITIONAL_DIMS = 4;
  const WINDOW = 32;
  // R5 E5: Reduced from 6 to 4 to accelerate phase warmup and bring phase pairs online sooner
  const MIN_WINDOW_DEFAULT = 4;
  const PHASE_COUPLING_PAIRS = ['density-phase', 'tension-phase', 'flicker-phase', 'entropy-phase'];
  const PHASE_STALE_PAIR_THRESHOLD = 8; // R33 E3: 12->8 faster phase stale detection for more responsive phase engagement
  const PHASE_FRESHNESS_ESCALATION = 3;
  const STATE_SMOOTHING_BASELINE = 0.12;
  const ZSCORE_MIN_SAMPLES = 8;
  const systemDynamicsProfilerConfig = {
    DIM_NAMES,
    N_DIMS,
    N_COMPOSITIONAL_DIMS,
    WINDOW,
    MIN_WINDOW_DEFAULT,
    PHASE_COUPLING_PAIRS,
    PHASE_STALE_PAIR_THRESHOLD,
    PHASE_FRESHNESS_ESCALATION,
    STATE_SMOOTHING_BASELINE,
    ZSCORE_MIN_SAMPLES
  };

  function systemDynamicsProfilerCreateState() {
    return {
      trajectory: [],
      rawTrajectory: [],
      velocities: [],
      beatsSeen: 0,
      analysisTick: 0,
      entropySampleErrors: 0,
      lastEntropyError: '',
      velocityEma: null,
      lastPhaseSample: null,
      lastPhaseDelta: 0,
      lastPhaseChanged: false,
      lastPhaseSignalValid: false,
      phaseStaleBeats: 0,
      lastBeatCountAtAnalysis: 0,
      zscoreN: new Array(N_COMPOSITIONAL_DIMS).fill(0),
      zscoreMean: new Array(N_COMPOSITIONAL_DIMS).fill(0),
      zscoreM2: new Array(N_COMPOSITIONAL_DIMS).fill(0),
      stateSmoothing: 0.30,
      stateSmoothingResolved: false,
      smoothedState: null,
      lastSnapshot: systemDynamicsProfilerHelpers.emptySnapshot(N_COMPOSITIONAL_DIMS, MIN_WINDOW_DEFAULT, PHASE_COUPLING_PAIRS)
    };
  }

  const systemDynamicsProfilerState = systemDynamicsProfilerCreateState();

  function analyze(analysisSourceInput) {
    return systemDynamicsProfilerAnalysis.analyze(systemDynamicsProfilerState, systemDynamicsProfilerConfig, analysisSourceInput);
  }

  function ensureBeatAnalysis(force) {
    const analysisSettings = systemDynamicsProfilerHelpers.getAnalysisSettings(MIN_WINDOW_DEFAULT);
    const currentBeatCounter = Number.isFinite(beatCount) ? beatCount : systemDynamicsProfilerState.beatsSeen;
    const beatDelta = currentBeatCounter - systemDynamicsProfilerState.lastBeatCountAtAnalysis;
    const warmupActive = systemDynamicsProfilerState.lastSnapshot.warmupTicksRemaining > 0;
    const phaseUnavailable = systemDynamicsProfilerState.lastSnapshot.phaseCouplingAvailablePairs === 0;
    const phaseStale = systemDynamicsProfilerState.lastSnapshot.phaseStaleBeats >= PHASE_STALE_PAIR_THRESHOLD;
    //  Phase freshness escalation. Force re-analysis when phase goes
    // stale beyond 8 beats to keep phase coupling data flowing. This is
    // more aggressive than PHASE_STALE_PAIR_THRESHOLD (12) and catches
    // staleness earlier before it becomes entrenched.
    const phaseFreshnessEscalation = systemDynamicsProfilerState.phaseStaleBeats >= PHASE_FRESHNESS_ESCALATION && systemDynamicsProfilerState.phaseStaleBeats < PHASE_STALE_PAIR_THRESHOLD;
    const sparsePhaseCoverage = systemDynamicsProfilerState.lastSnapshot.phaseCouplingCoverage < 0.5;
    const snapshotStale = beatDelta >= analysisSettings.snapshotReuseBeats;
    if (beatDelta <= 0) return systemDynamicsProfilerState.lastSnapshot;
    if (force || warmupActive || phaseUnavailable || phaseStale || phaseFreshnessEscalation || (sparsePhaseCoverage && beatDelta >= m.max(1, analysisSettings.snapshotReuseBeats - 1)) || snapshotStale) {
      return analyze('beat-escalation');
    }
    return systemDynamicsProfilerState.lastSnapshot;
  }

  /** @returns {SystemDynamicsSnapshot} */
  function getSnapshot() { return systemDynamicsProfilerState.lastSnapshot; }

  /**
   * End-of-run summary for system manifest.
   * @returns {SystemDynamicsSummary}
   */
  function getSummary() {
    return {
      beatsAnalyzed: systemDynamicsProfilerState.beatsSeen,
      snapshot: systemDynamicsProfilerState.lastSnapshot,
      dimensionNames: DIM_NAMES.slice()
    };
  }

  function reset() {
    entropyAmplificationController.reset();
    regimeClassifier.reset();
    const fresh = systemDynamicsProfilerCreateState();
    const keys = Object.keys(fresh);
    for (let i = 0; i < keys.length; i++) systemDynamicsProfilerState[keys[i]] = fresh[keys[i]];
  }

  // -- Self-register --
  conductorIntelligence.registerRecorder('systemDynamicsProfiler', () => { systemDynamicsProfiler.analyze('measure-recorder'); });
  conductorIntelligence.registerStateProvider('systemDynamicsProfiler', () => ({
    dynamicsRegime: systemDynamicsProfilerState.lastSnapshot.regime,
    dynamicsGrade: systemDynamicsProfilerState.lastSnapshot.grade,
    dynamicsVelocity: systemDynamicsProfilerState.lastSnapshot.velocity,
    dynamicsCurvature: systemDynamicsProfilerState.lastSnapshot.curvature,
    dynamicsEffectiveDim: systemDynamicsProfilerState.lastSnapshot.effectiveDimensionality,
    dynamicsCouplingStrength: systemDynamicsProfilerState.lastSnapshot.couplingStrength
  }));
  conductorIntelligence.registerModule('systemDynamicsProfiler', { reset }, ['all']);

  return { analyze, ensureBeatAnalysis, getSnapshot, getSummary, reset };
})();
