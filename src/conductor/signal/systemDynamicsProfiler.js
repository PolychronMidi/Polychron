// systemDynamicsProfiler.js - Phase-space trajectory analysis of the signal organism.
// Treats the entire system as a dynamical entity moving through a multi-dimensional
// state space. Analyzes the SHAPE of that movement - not individual pipelines, but
// the emergent geometry of how all dimensions co-evolve.
//
// Five metrics, each invisible to single-pipeline analyzers:
//   1. Trajectory velocity - how fast the state is changing (stuck vs evolving)
//   2. Trajectory curvature - turning behavior (straight vs winding)
//   3. Cross-coupling - rolling correlations between dimension pairs
//   4. Effective dimensionality - how many independent axes are in use
//   5. Regime detection - qualitative shifts in system operating mode
//
// Does NOT modify signal values - pure observation + diagnostics.

systemDynamicsProfiler = (() => {
  // -- Phase space dimensions --
  // Full 6D state space for the coupling matrix (diagnostic exposure).
  // Only the first N_COMPOSITIONAL_DIMS are used for velocity, curvature,
  // coupling strength, and effective dimensionality - because trust
  // (governance meta-signal) and phase (monotonic sawtooth) inflate
  // those metrics without reflecting compositional oscillation.
  const DIM_NAMES = ['density', 'tension', 'flicker', 'entropy', 'trust', 'phase'];
  const N_DIMS = DIM_NAMES.length;
  const N_COMPOSITIONAL_DIMS = 4; // density, tension, flicker, entropy
  const WINDOW = 32; // rolling window for statistics
  const MIN_WINDOW_DEFAULT = 6; // minimum beats before meaningful analysis
  const PHASE_COUPLING_PAIRS = ['density-phase', 'tension-phase', 'flicker-phase', 'entropy-phase'];
  const PHASE_STALE_PAIR_THRESHOLD = 12;

  // -- State --
  /** @type {Array<number[]>} smoothed ring buffer for velocity/curvature */
  const trajectory = [];
  /** @type {Array<number[]>} raw ring buffer for coupling/dimensionality */
  const rawTrajectory = [];
  /** @type {Array<number[]>} velocity vectors (first differences) */
  const velocities = [];
  let beatsSeen = 0;
  let _analysisTick = 0;
  let _entropySampleErrors = 0;
  let _lastEntropyError = '';
  // R13 Evo 6: Velocity EMA
  let _velocityEma = null;
  let _lastPhaseSample = null;
  let _lastPhaseDelta = 0;
  let _lastPhaseChanged = false;
  let _lastPhaseSignalValid = false;
  let _phaseStaleBeats = 0;
  let _lastBeatCountAtAnalysis = 0;

  // -- Per-dimension z-score normalization --
  // Pipeline products (density/tension/flicker) are multiplicative products of
  // 14-29 modules that mutually smooth, producing tiny variance. Entropy is a
  // single direct ATW measurement with inherently higher variance. Without
  // normalization, entropy dominates compositionalVariance (96%-72%-58% across
  // runs) regardless of amplification tuning. Z-scoring each compositional
  // dimension by its own rolling mean/std ensures unit variance by construction.
  // Uses Welford's online algorithm for numerical stability.
  const _zscoreN = new Array(N_COMPOSITIONAL_DIMS).fill(0);
  const _zscoreMean = new Array(N_COMPOSITIONAL_DIMS).fill(0);
  const _zscoreM2 = new Array(N_COMPOSITIONAL_DIMS).fill(0);
  const _ZSCORE_MIN_SAMPLES = 8; // need enough history before z-scoring is meaningful

  // Pre-differentiation EMA: smooths the raw state vector before computing
  // velocity/curvature. Without this, first-differences amplify beat-to-beat
  // noise from 74 independent modules, inflating curvature artificially.
  //
  // Adaptive: the profile's density smoothing already attenuates the noisiest
  // dimension. Heavy profile smoothing (explosive=0.5) needs lighter profiler
  // smoothing; light profile smoothing (default=0.8) needs heavier. Targeting
  // a constant effective responsiveness: profileSmoothing * stateSmoothing ~ 0.175.
  const _STATE_SMOOTHING_BASELINE = 0.12; // lowered (was 0.14) - velocity 0.008 in Run 8 still near-stasis; increase responsiveness further
  let _stateSmoothing = 0.30; // conservative default, resolved lazily
  let _stateSmoothingResolved = false;

  function _resolveStateSmoothing() {
    if (_stateSmoothingResolved) return;
    try {
      const profileSmoothing = conductorConfig.getDensitySmoothing();
      _stateSmoothing = clamp(_STATE_SMOOTHING_BASELINE / profileSmoothing, 0.15, 0.40);

      // Scale oscillating threshold by profile character (delegated to regimeClassifier)
      const profileName = conductorConfig.getActiveProfileName();
      if (profileName === 'explosive') {
        regimeClassifier.setOscillatingThreshold(0.65);
        // R30: Removed manual coherentThresholdScale (was 0.84). The regime
        // self-balancing in regimeClassifier now controls this automatically
        // for ALL profiles. In R29, starting at 0.84 with EMA=0.50 caused
        // immediate downward drift to floor (0.80) and 0% coherent.
        // R21 E3: Faster alpha floor for explosive -- shorter sections need
        // ~25-beat convergence to prevent 74.2% coherent lock.
        regimeClassifier.setCoherentShareAlphaMin(0.04);
        // R22 E4 / R24 E1: Evolving min dwell for explosive -- R22's 12-beat
        // dwell disrupted bistable coherent feedback loop (0% coherent in R23).
        // 4-beat dwell still prevents 7-beat snap but allows coherent entry
        // within the coupling feedback window.
        regimeClassifier.setEvolvingMinDwell(5);
        // R8 Evo 4: widen flicker target range for explosive depthScale 1.8
        conductorDampening.setFlickerTargetRange(0.15 * 1.8);
        // R9 Evo 3: give density-flicker pair 30% extra gain ceiling for decorrelation
        pipelineCouplingManager.setDensityFlickerGainScale(1.3);
      } else if (profileName === 'atmospheric') {
        // R29: Removed manual coherentThresholdScale (was 0.90). The regime
        // self-balancing in regimeClassifier now auto-adjusts the scale to
        // target 15-35% coherent share, replacing manual per-profile tuning.
        // R28 E4: Alpha floor 0.03 retained -- faster EMA convergence helps
        // the self-balancing loop track coherent share more accurately.
        regimeClassifier.setCoherentShareAlphaMin(0.03);
        // R22 E4 / R24 E1: Atmospheric evolving dwell -- reduced from 8 to 6
        // to match regime bistability fix. Longer sections need slightly more
        // dwell than explosive but still within the coherent feedback window.
        regimeClassifier.setEvolvingMinDwell(7);
      } else if (profileName === 'minimal') {
        regimeClassifier.setOscillatingThreshold(0.45);
      }
    } catch {
      _stateSmoothing = 0.30;
    }
    _stateSmoothingResolved = true;
  }

  /** @type {number[] | null} */
  let _smoothedState = null;

  /** @type {SystemDynamicsSnapshot} */
  let _lastSnapshot = _emptySnapshot();

  function _getAnalysisSettings() {
    let profile = null;
    try {
      profile = conductorConfig.getActiveProfile();
    } catch {
      profile = null;
    }
    const analysis = profile && typeof profile.analysis === 'object' ? profile.analysis : null;
    const configuredWarmup = analysis && Number.isFinite(analysis.warmupTicks)
      ? m.round(analysis.warmupTicks)
      : MIN_WINDOW_DEFAULT;
    const configuredReuse = analysis && Number.isFinite(analysis.snapshotReuseBeats)
      ? m.round(analysis.snapshotReuseBeats)
      : 3;
    const shortRunCompression = Number.isFinite(totalSections) && totalSections > 0 && totalSections <= 5 ? 1 : 0;
    return {
      warmupTicks: clamp(configuredWarmup - shortRunCompression, 3, 10),
      snapshotReuseBeats: clamp(configuredReuse, 1, 8)
    };
  }

  function _getPhasePairStates(matrix) {
    /** @type {Record<string, string>} */
    const states = {};
    const phaseSignalStale = _lastPhaseSignalValid && !_lastPhaseChanged && _phaseStaleBeats >= PHASE_STALE_PAIR_THRESHOLD;
    for (let i = 0; i < PHASE_COUPLING_PAIRS.length; i++) {
      const pair = PHASE_COUPLING_PAIRS[i];
      const value = matrix && Object.prototype.hasOwnProperty.call(matrix, pair)
        ? matrix[pair]
        : undefined;
      if (typeof value === 'number' && Number.isFinite(value)) states[pair] = phaseSignalStale ? 'stale' : 'available';
      else if (typeof value === 'number' && Number.isNaN(value)) states[pair] = phaseSignalStale ? 'stale-gated' : 'variance-gated';
      else states[pair] = 'missing';
    }
    return states;
  }

  /** @returns {SystemDynamicsSnapshot} */
  function _emptySnapshot() {
    return {
      velocity: 0,
      curvature: 0,
      effectiveDimensionality: N_COMPOSITIONAL_DIMS,
      couplingStrength: 0,
      regime: 'initializing',
      grade: 'healthy',
      couplingMatrix: {},
      compositionalVariance: [0.25, 0.25, 0.25, 0.25],
      entropyAmplification: entropyAmplificationController.getAmp(),
      entropySampleErrors: 0,
      entropyRhythmErrors: 0,
      lastEntropyError: '',
      phaseValue: 0,
      phaseDelta: 0,
      phaseChanged: false,
      phaseStaleBeats: 0,
      phaseSignalValid: false,
      phaseCouplingCoverage: 0,
      phaseCouplingAvailablePairs: 0,
      phaseCouplingMissingPairs: 4,
      phasePairStates: {
        'density-phase': 'warmup',
        'tension-phase': 'warmup',
        'flicker-phase': 'warmup',
        'entropy-phase': 'warmup'
      },
      profilerTick: 0,
      regimeTick: 0,
      trajectorySamples: 0,
      telemetryBeatSpan: 1,
      warmupTicksRemaining: MIN_WINDOW_DEFAULT,
      profilerCadence: 'measure-recorder',
      cadenceEscalated: false,
      analysisSource: 'measure-recorder'
    };
  }

  // -- Vector math & correlation analysis delegated to phaseSpaceMath --

  // -- Core analysis --

  /** Sample the current state vector from live signal data. @returns {number[]} */
  function _sampleState() {
    const snap = signalReader.snapshot();
    let avgTrust = 0;
    let trustCount = 0;
    try {
      const ts = adaptiveTrustScores.getSnapshot();
      const entries = Object.values(ts);
      for (let i = 0; i < entries.length; i++) {
        if (entries[i] && typeof entries[i].score === 'number') {
          avgTrust += entries[i].score;
          trustCount++;
        }
      }
      if (trustCount > 0) avgTrust /= trustCount;
    } catch { /* non-fatal */ }

    // Compute truly instantaneous entropy directly from absoluteTimeWindow,
    // bypassing entropyRegulator's triple-dampened pipeline (10-note sliding
    // window - EMA smoothing - beatCache memoization) which produced variance
    // - 0 across 3 consecutive runs. A 1-second ATW query gives real beat-to-
    // beat content changes as notes enter/leave the window.
    let entropy = 0.5;
    try {
      const atwSince = beatStartTime - 1.0;
      const recentNotes = absoluteTimeWindow.getNotes({ since: atwSince, windowSeconds: 1.0 });
      if (recentNotes.length >= 3) {
        const midis = new Array(recentNotes.length);
        const vels = new Array(recentNotes.length);
        for (let i = 0; i < recentNotes.length; i++) {
          midis[i] = recentNotes[i].midi;
          vels[i] = recentNotes[i].velocity;
        }
        const pitchE = entropyMetrics.pitchEntropy(midis);
        const velE = entropyMetrics.velocityVariance(vels);
        // IOI-based rhythmic irregularity (inline - avoids per-layer ATW re-query)
        let rhythmE = 0;
        const iois = [];
        for (let i = 1; i < recentNotes.length; i++) {
          const dt = recentNotes[i].time - recentNotes[i - 1].time;
          if (dt > 0) iois.push(dt);
        }
        if (iois.length >= 2) {
          const ioiMean = iois.reduce((a, b) => a + b, 0) / iois.length;
          const ioiStd = m.sqrt(iois.reduce((s, v) => s + (v - ioiMean) * (v - ioiMean), 0) / iois.length);
          rhythmE = clamp(ioiStd / m.max(ioiMean, 0.001), 0, 1);
        }
        const combined = pitchE * 0.4 + velE * 0.3 + rhythmE * 0.3;
        entropyAmplificationController.adapt(_lastSnapshot.compositionalVariance[3]);
        entropy = 0.5 + (combined - 0.5) * entropyAmplificationController.getAmp();
      }
    } catch (e) {
      _entropySampleErrors++;
      _lastEntropyError = e && e.message ? e.message : 'unknown';
      explainabilityBus.emit('entropy-sample-error', 'both', {
        error: _lastEntropyError,
        errorCount: _entropySampleErrors
      });
    }

    let phase = 0;
    _lastPhaseSignalValid = false;
    _lastPhaseChanged = false;
    _lastPhaseDelta = 0;
    try {
      const sampledPhase = timeStream.normalizedProgress('section');
      if (typeof sampledPhase === 'number' && Number.isFinite(sampledPhase)) {
        phase = clamp(sampledPhase, 0, 1);
        _lastPhaseSignalValid = true;
      }
    } catch { /* non-fatal */ }

    if (_lastPhaseSignalValid) {
      if (_lastPhaseSample !== null) {
        _lastPhaseDelta = m.abs(phase - _lastPhaseSample);
        _lastPhaseChanged = _lastPhaseDelta > 0.0005;
        _phaseStaleBeats = _lastPhaseChanged ? 0 : _phaseStaleBeats + 1;
      } else {
        _phaseStaleBeats = 0;
      }
      _lastPhaseSample = phase;
    } else {
      _phaseStaleBeats++;
    }

    return [
      snap.densityProduct,
      snap.tensionProduct,
      snap.flickerProduct,
      entropy,
      avgTrust,
      phase
    ];
  }

  // _stats, _coupling, _effectiveDimensionality, _jacobiEigenvalues
  // are now in phaseSpaceMath global - called as phaseSpaceMath.stats() etc.
  // _classifyRegime, _resolveRegime, _grade are now in regimeClassifier global.

  /** Run per-beat analysis. Called via conductorIntelligence recorder. */
  function analyze(analysisSourceInput) {
    const analysisSource = typeof analysisSourceInput === 'string' && analysisSourceInput ? analysisSourceInput : 'measure-recorder';
    const analysisSettings = _getAnalysisSettings();
    beatsSeen++;
    _analysisTick++;
    const rawState = _sampleState();
    const currentBeatCounter = Number.isFinite(beatCount) ? beatCount : beatsSeen;
    const telemetryBeatSpan = _analysisTick > 1
      ? m.max(1, currentBeatCounter - _lastBeatCountAtAnalysis)
      : 1;
    _lastBeatCountAtAnalysis = currentBeatCounter;

    // -- Z-score normalize compositional dimensions --
    // Update Welford accumulators then normalize. Non-compositional dims
    // (trust, phase) pass through unchanged - they're excluded from
    // velocity/curvature/variance computations anyway.
    const normalizedState = rawState.slice();
    for (let d = 0; d < N_COMPOSITIONAL_DIMS; d++) {
      _zscoreN[d]++;
      const delta = rawState[d] - _zscoreMean[d];
      _zscoreMean[d] += delta / _zscoreN[d];
      _zscoreM2[d] += delta * (rawState[d] - _zscoreMean[d]);
      if (_zscoreN[d] >= _ZSCORE_MIN_SAMPLES) {
        const std = m.sqrt(_zscoreM2[d] / _zscoreN[d]);
        normalizedState[d] = std > 1e-10 ? (rawState[d] - _zscoreMean[d]) / std : 0;
      }
    }

    // EMA smooth the normalized state vector to suppress high-frequency
    // module noise before differentiation.
    _resolveStateSmoothing();
    if (!_smoothedState) {
      _smoothedState = normalizedState.slice();
    } else {
      for (let d = 0; d < N_DIMS; d++) {
        _smoothedState[d] = _smoothedState[d] * (1 - _stateSmoothing) + normalizedState[d] * _stateSmoothing;
      }
    }
    const state = _smoothedState.slice();

    // Smoothed trajectory - velocity/curvature (derivatives need smooth input)
    trajectory.push(state);
    if (trajectory.length > WINDOW) trajectory.shift();

    // Normalized trajectory - coupling/dimensionality (z-scored, not EMA-smoothed)
    rawTrajectory.push(normalizedState.slice());
    if (rawTrajectory.length > WINDOW) rawTrajectory.shift();

    // Compute velocity (first difference) - compositional dims only.
    // Trust and phase are excluded: trust is a governance meta-signal whose
    // density anti-correlation inflates curvature, and phase is monotonic.
    if (trajectory.length >= 2) {
      const prev = trajectory[trajectory.length - 2];
      const curr = trajectory[trajectory.length - 1];
      const vel = new Array(N_COMPOSITIONAL_DIMS);
      for (let d = 0; d < N_COMPOSITIONAL_DIMS; d++) vel[d] = curr[d] - prev[d];
      velocities.push(vel);
      if (velocities.length > WINDOW) velocities.shift();
    }

    // Need minimum history for meaningful analysis
    if (trajectory.length < analysisSettings.warmupTicks) {
      _lastSnapshot = Object.assign({}, _lastSnapshot, {
        phaseValue: _lastPhaseSample !== null ? Number(_lastPhaseSample.toFixed(4)) : 0,
        phaseDelta: Number(_lastPhaseDelta.toFixed(4)),
        phaseChanged: _lastPhaseChanged,
        phaseStaleBeats: _phaseStaleBeats,
        phaseSignalValid: _lastPhaseSignalValid,
        phaseCouplingCoverage: 0,
        phaseCouplingAvailablePairs: 0,
        phaseCouplingMissingPairs: PHASE_COUPLING_PAIRS.length,
        phasePairStates: {
          'density-phase': 'warmup',
          'tension-phase': 'warmup',
          'flicker-phase': 'warmup',
          'entropy-phase': 'warmup'
        },
        profilerTick: _analysisTick,
        regimeTick: _analysisTick,
        trajectorySamples: trajectory.length,
        telemetryBeatSpan,
        warmupTicksRemaining: m.max(0, analysisSettings.warmupTicks - trajectory.length),
        profilerCadence: analysisSource === 'measure-recorder' ? 'measure-recorder' : 'measure-recorder+beat-escalation',
        cadenceEscalated: analysisSource !== 'measure-recorder',
        analysisSource
      });
      return _lastSnapshot;
    }

    // -- Trajectory velocity (mean magnitude of velocity vectors) --
    let avgVelocity = 0;
    for (let i = 0; i < velocities.length; i++) {
      avgVelocity += phaseSpaceMath.magnitude(velocities[i]);
    }
    avgVelocity /= m.max(1, velocities.length);

    // R13 Evo 6: Profiler Tension Velocity Smoothing
    // Apply EMA to lower mid-curve velocity jitter, giving the arc more definition
    if (_velocityEma === null) _velocityEma = avgVelocity;
    _velocityEma = _velocityEma * 0.85 + avgVelocity * 0.15;
    avgVelocity = _velocityEma;

    // -- Trajectory curvature (mean angle between consecutive velocities) --
    let avgCurvature = 0;
    let curvCount = 0;
    for (let i = 1; i < velocities.length; i++) {
      const cos = phaseSpaceMath.cosine(velocities[i - 1], velocities[i]);
      // curvature = 1 - cos: 0 = straight, 1 = right angle, 2 = reversal
      avgCurvature += 1 - cos;
      curvCount++;
    }
    if (curvCount > 0) avgCurvature /= curvCount;

    // Cross-coupling & effective dimensionality (from RAW trajectory)
    const { mean, variance } = phaseSpaceMath.stats(rawTrajectory, N_DIMS);
    const { matrix, strength } = phaseSpaceMath.coupling(rawTrajectory, mean, DIM_NAMES, N_DIMS, N_COMPOSITIONAL_DIMS);
    const effDim = phaseSpaceMath.effectiveDimensionality(rawTrajectory, mean, N_COMPOSITIONAL_DIMS);
    const phasePairStates = _getPhasePairStates(matrix);
    let phaseCouplingAvailablePairs = 0;
    for (let i = 0; i < PHASE_COUPLING_PAIRS.length; i++) {
      if (phasePairStates[PHASE_COUPLING_PAIRS[i]] === 'available') phaseCouplingAvailablePairs++;
    }
    const phaseCouplingCoverage = PHASE_COUPLING_PAIRS.length > 0
      ? phaseCouplingAvailablePairs / PHASE_COUPLING_PAIRS.length
      : 0;
    // per-axis variance ratios for dead-axis detection.
    // Normalized so they sum to 1.0 - a value near 0 means that axis
    // contributes negligible variance to the phase-space trajectory.
    let varTotal = 0;
    for (let d = 0; d < N_COMPOSITIONAL_DIMS; d++) varTotal += variance[d];
    const varRatios = new Array(N_COMPOSITIONAL_DIMS);
    for (let d = 0; d < N_COMPOSITIONAL_DIMS; d++) {
      varRatios[d] = varTotal > 1e-12 ? variance[d] / varTotal : 1 / N_COMPOSITIONAL_DIMS;
    }
    // -- Regime classification (with hysteresis, delegated to regimeClassifier) --
    const rawRegime = regimeClassifier.classify(avgVelocity, avgCurvature, effDim, strength);
    const regime = regimeClassifier.resolve(rawRegime, _analysisTick);
    const grade = regimeClassifier.grade(regime);

    _lastSnapshot = {
      velocity: m.round(avgVelocity * 10000) / 10000,
      curvature: m.round(avgCurvature * 1000) / 1000,
      effectiveDimensionality: m.round(effDim * 100) / 100,
      couplingStrength: m.round(strength * 1000) / 1000,
      regime,
      grade,
      couplingMatrix: matrix,
      compositionalVariance: varRatios,
      entropyAmplification: m.round(entropyAmplificationController.getAmp() * 100) / 100,
      entropySampleErrors: _entropySampleErrors,
      entropyRhythmErrors: entropyRegulator.getRhythmErrors(),
      lastEntropyError: _lastEntropyError,
      phaseValue: _lastPhaseSample !== null ? Number(_lastPhaseSample.toFixed(4)) : 0,
      phaseDelta: Number(_lastPhaseDelta.toFixed(4)),
      phaseChanged: _lastPhaseChanged,
      phaseStaleBeats: _phaseStaleBeats,
      phaseSignalValid: _lastPhaseSignalValid,
      phaseCouplingCoverage: Number(phaseCouplingCoverage.toFixed(4)),
      phaseCouplingAvailablePairs,
      phaseCouplingMissingPairs: PHASE_COUPLING_PAIRS.length - phaseCouplingAvailablePairs,
      phasePairStates,
      profilerTick: _analysisTick,
      regimeTick: _analysisTick,
      trajectorySamples: trajectory.length,
      telemetryBeatSpan,
      warmupTicksRemaining: 0,
      profilerCadence: analysisSource === 'measure-recorder' ? 'measure-recorder' : 'measure-recorder+beat-escalation',
      cadenceEscalated: analysisSource !== 'measure-recorder',
      analysisSource
    };

    // Emit real-time telemetry on every beat for observability
    explainabilityBus.emit('system-dynamics-telemetry', 'both', {
      regime,
      grade,
      velocity: _lastSnapshot.velocity,
      curvature: _lastSnapshot.curvature,
      effectiveDimensionality: _lastSnapshot.effectiveDimensionality,
      couplingStrength: _lastSnapshot.couplingStrength,
      stateVector: rawState // The full 6D state
    }, beatStartTime * 1000);

    // Emit diagnostics on non-healthy beats
    if (grade !== 'healthy') {
      explainabilityBus.emit('system-dynamics', 'both', {
        regime,
        grade,
        velocity: _lastSnapshot.velocity,
        curvature: _lastSnapshot.curvature,
        effectiveDimensionality: _lastSnapshot.effectiveDimensionality,
        couplingStrength: _lastSnapshot.couplingStrength
      }, beatStartTime * 1000);
    }

    return _lastSnapshot;
  }

  function ensureBeatAnalysis(force) {
    const analysisSettings = _getAnalysisSettings();
    const currentBeatCounter = Number.isFinite(beatCount) ? beatCount : beatsSeen;
    const beatDelta = currentBeatCounter - _lastBeatCountAtAnalysis;
    const warmupActive = _lastSnapshot.warmupTicksRemaining > 0;
    const phaseUnavailable = _lastSnapshot.phaseCouplingAvailablePairs === 0;
    const phaseStale = _lastSnapshot.phaseStaleBeats >= PHASE_STALE_PAIR_THRESHOLD;
    const sparsePhaseCoverage = _lastSnapshot.phaseCouplingCoverage < 0.5;
    const snapshotStale = beatDelta >= analysisSettings.snapshotReuseBeats;
    if (beatDelta <= 0) return _lastSnapshot;
    if (force || warmupActive || phaseUnavailable || phaseStale || (sparsePhaseCoverage && beatDelta >= m.max(1, analysisSettings.snapshotReuseBeats - 1)) || snapshotStale) {
      return analyze('beat-escalation');
    }
    return _lastSnapshot;
  }

  /** @returns {SystemDynamicsSnapshot} */
  function getSnapshot() { return _lastSnapshot; }

  /**
   * End-of-run summary for system manifest.
   * @returns {SystemDynamicsSummary}
   */
  function getSummary() {
    return {
      beatsAnalyzed: beatsSeen,
      snapshot: _lastSnapshot,
      dimensionNames: DIM_NAMES.slice()
    };
  }

  function reset() {
    trajectory.length = 0;
    rawTrajectory.length = 0;
    velocities.length = 0;
    beatsSeen = 0;
    _analysisTick = 0;
    _smoothedState = null;
    _stateSmoothingResolved = false;
    _stateSmoothing = 0.30;
    _lastSnapshot = _emptySnapshot();
    _lastPhaseSample = null;
    _lastPhaseDelta = 0;
    _lastPhaseChanged = false;
    _lastPhaseSignalValid = false;
    _phaseStaleBeats = 0;
    _lastBeatCountAtAnalysis = 0;
    entropyAmplificationController.reset();
    regimeClassifier.reset();
    for (let d = 0; d < N_COMPOSITIONAL_DIMS; d++) {
      _zscoreN[d] = 0;
      _zscoreMean[d] = 0;
      _zscoreM2[d] = 0;
    }
  }

  // -- Self-register --
  conductorIntelligence.registerRecorder('systemDynamicsProfiler', () => { systemDynamicsProfiler.analyze('measure-recorder'); });
  conductorIntelligence.registerStateProvider('systemDynamicsProfiler', () => ({
    dynamicsRegime: _lastSnapshot.regime,
    dynamicsGrade: _lastSnapshot.grade,
    dynamicsVelocity: _lastSnapshot.velocity,
    dynamicsCurvature: _lastSnapshot.curvature,
    dynamicsEffectiveDim: _lastSnapshot.effectiveDimensionality,
    dynamicsCouplingStrength: _lastSnapshot.couplingStrength
  }));
  // Scope 'all' - profiler accumulates across sections because trajectory
  // shape (velocity, curvature, coupling) is meaningful across key changes.
  // Section resets were discarding history in short compositions, causing
  // sparse statistics and unreliable regime classification.
  conductorIntelligence.registerModule('systemDynamicsProfiler', { reset }, ['all']);

  return { analyze, ensureBeatAnalysis, getSnapshot, getSummary, reset };
})();
