systemDynamicsProfilerAnalysis = (() => {
  function systemDynamicsProfilerAnalysisResolveStateSmoothing(state, config) {
    if (state.stateSmoothingResolved) return;
    try {
      const profileSmoothing = conductorConfig.getDensitySmoothing();
      state.stateSmoothing = clamp(config.STATE_SMOOTHING_BASELINE / profileSmoothing, 0.15, 0.40);
      const profileName = conductorConfig.getActiveProfileName();
      if (profileName === 'explosive') {
        regimeClassifier.setOscillatingThreshold(0.65);
        regimeClassifier.setCoherentShareAlphaMin(0.04);
        regimeClassifier.setEvolvingMinDwell(5);
        regimeClassifier.setEvolvingMinDwellSec(4.2);
        conductorDampening.setFlickerTargetRange(0.15 * 1.8);
        pipelineCouplingManager.setDensityFlickerGainScale(1.3);
      } else if (profileName === 'atmospheric') {
        regimeClassifier.setOscillatingThreshold(0.14);
        regimeClassifier.setCoherentShareAlphaMin(0.03);
        regimeClassifier.setEvolvingMinDwell(7);
        regimeClassifier.setEvolvingMinDwellSec(5.8);
      } else if (profileName === 'minimal') {
        regimeClassifier.setOscillatingThreshold(0.45);
      }
    } catch { /* boot-safety: dependency may not be ready */
      state.stateSmoothing = 0.30;
    }
    state.stateSmoothingResolved = true;
  }

  function analyze(state, config, analysisSourceInput) {
    const analysisSource = typeof analysisSourceInput === 'string' && analysisSourceInput ? analysisSourceInput : 'measure-recorder';
    const analysisSettings = systemDynamicsProfilerHelpers.getAnalysisSettings(config.MIN_WINDOW_DEFAULT);
    state.beatsSeen++;
    state.analysisTick++;

    const helperState = {
      entropySampleErrors: state.entropySampleErrors,
      lastEntropyError: state.lastEntropyError,
      lastSnapshot: state.lastSnapshot,
      lastPhaseSignalValid: state.lastPhaseSignalValid,
      lastPhaseChanged: state.lastPhaseChanged,
      lastPhaseDelta: state.lastPhaseDelta,
      phaseStaleBeats: state.phaseStaleBeats,
      lastPhaseSample: state.lastPhaseSample,
    };
    const rawState = systemDynamicsProfilerHelpers.sampleState(helperState);
    state.entropySampleErrors = helperState.entropySampleErrors;
    state.lastEntropyError = helperState.lastEntropyError;
    state.lastPhaseSignalValid = helperState.lastPhaseSignalValid;
    state.lastPhaseChanged = helperState.lastPhaseChanged;
    state.lastPhaseDelta = helperState.lastPhaseDelta;
    state.phaseStaleBeats = helperState.phaseStaleBeats;
    state.lastPhaseSample = helperState.lastPhaseSample;

    const currentBeatCounter = Number.isFinite(beatCount) ? beatCount : state.beatsSeen;
    const telemetryBeatSpan = state.analysisTick > 1
      ? m.max(1, currentBeatCounter - state.lastBeatCountAtAnalysis)
      : 1;
    state.lastBeatCountAtAnalysis = currentBeatCounter;

    const normalizedState = rawState.slice();
    for (let d = 0; d < config.N_COMPOSITIONAL_DIMS; d++) {
      state.zscoreN[d]++;
      const delta = rawState[d] - state.zscoreMean[d];
      state.zscoreMean[d] += delta / state.zscoreN[d];
      state.zscoreM2[d] += delta * (rawState[d] - state.zscoreMean[d]);
      if (state.zscoreN[d] >= config.ZSCORE_MIN_SAMPLES) {
        const std = m.sqrt(state.zscoreM2[d] / state.zscoreN[d]);
        normalizedState[d] = std > 1e-10 ? (rawState[d] - state.zscoreMean[d]) / std : 0;
      }
    }

    systemDynamicsProfilerAnalysisResolveStateSmoothing(state, config);
    if (!state.smoothedState) state.smoothedState = normalizedState.slice();
    else {
      for (let d = 0; d < config.N_DIMS; d++) {
        state.smoothedState[d] = state.smoothedState[d] * (1 - state.stateSmoothing) + normalizedState[d] * state.stateSmoothing;
      }
    }

    const smoothed = state.smoothedState.slice();
    state.trajectory.push(smoothed);
    if (state.trajectory.length > config.WINDOW) state.trajectory.shift();
    state.rawTrajectory.push(normalizedState.slice());
    if (state.rawTrajectory.length > config.WINDOW) state.rawTrajectory.shift();

    if (state.trajectory.length >= 2) {
      const prev = state.trajectory[state.trajectory.length - 2];
      const curr = state.trajectory[state.trajectory.length - 1];
      const vel = new Array(config.N_COMPOSITIONAL_DIMS);
      for (let d = 0; d < config.N_COMPOSITIONAL_DIMS; d++) vel[d] = curr[d] - prev[d];
      state.velocities.push(vel);
      if (state.velocities.length > config.WINDOW) state.velocities.shift();
    }

    if (state.trajectory.length < analysisSettings.warmupTicks) {
      state.lastSnapshot = Object.assign({}, state.lastSnapshot, {
        phaseValue: state.lastPhaseSample !== null ? Number(state.lastPhaseSample.toFixed(4)) : 0,
        phaseDelta: Number(state.lastPhaseDelta.toFixed(4)),
        phaseChanged: state.lastPhaseChanged,
        phaseStaleBeats: state.phaseStaleBeats,
        phaseSignalValid: state.lastPhaseSignalValid,
        phaseCouplingCoverage: 0,
        phaseCouplingAvailablePairs: 0,
        phaseCouplingMissingPairs: config.PHASE_COUPLING_PAIRS.length,
        phasePairStates: {
          'density-phase': 'warmup',
          'tension-phase': 'warmup',
          'flicker-phase': 'warmup',
          'entropy-phase': 'warmup'
        },
        profilerTick: state.analysisTick,
        regimeTick: state.analysisTick,
        trajectorySamples: state.trajectory.length,
        telemetryBeatSpan,
        warmupTicksRemaining: m.max(0, analysisSettings.warmupTicks - state.trajectory.length),
        profilerCadence: analysisSource === 'measure-recorder' ? 'measure-recorder' : 'measure-recorder+beat-escalation',
        cadenceEscalated: analysisSource !== 'measure-recorder',
        analysisSource
      });
      return state.lastSnapshot;
    }

    let avgVelocity = 0;
    for (let i = 0; i < state.velocities.length; i++) avgVelocity += phaseSpaceMath.magnitude(state.velocities[i]);
    avgVelocity /= m.max(1, state.velocities.length);
    if (state.velocityEma === null) state.velocityEma = avgVelocity;
    state.velocityEma = state.velocityEma * 0.85 + avgVelocity * 0.15;
    avgVelocity = state.velocityEma;

    let avgCurvature = 0;
    let curvCount = 0;
    for (let i = 1; i < state.velocities.length; i++) {
      const cos = phaseSpaceMath.cosine(state.velocities[i - 1], state.velocities[i]);
      avgCurvature += 1 - cos;
      curvCount++;
    }
    if (curvCount > 0) avgCurvature /= curvCount;

    const stats = phaseSpaceMath.stats(state.rawTrajectory, config.N_DIMS);
    const varianceGateRelax = state.phaseStaleBeats > 10
      ? m.max(0.62, m.pow(0.85, (state.phaseStaleBeats - 10) / 15))
      : 1.0;
    const profileGateScale = conductorConfig.getActiveProfile().phaseVarianceGateScale ?? 1.0;
    // relaxes variance gate when phase is chronically near-zero
    const orchestratorGateRelax = /** @type {number} */ (hyperMetaManager.getVarianceGateRelaxMultiplier());
    const relaxedGateThreshold = 0.005 * varianceGateRelax * profileGateScale * orchestratorGateRelax;
    const coupling = phaseSpaceMath.coupling(state.rawTrajectory, stats.mean, config.DIM_NAMES, config.N_DIMS, config.N_COMPOSITIONAL_DIMS, relaxedGateThreshold);
    const effDim = phaseSpaceMath.effectiveDimensionality(state.rawTrajectory, stats.mean, config.N_COMPOSITIONAL_DIMS);
    // Relax stale threshold when orchestrator is relaxing variance gate.
    // When phase is chronically near-zero and gate is relaxed, newly-admitted
    // pairs shouldn't immediately be marked stale. Scale threshold up to 2x.
    const staleRelax = orchestratorGateRelax > 1.0
      ? m.round(config.PHASE_STALE_PAIR_THRESHOLD * clamp(orchestratorGateRelax, 1.0, 2.0))
      : config.PHASE_STALE_PAIR_THRESHOLD;
    const phasePairStates = systemDynamicsProfilerHelpers.getPhasePairStates(
      coupling.matrix,
      config.PHASE_COUPLING_PAIRS,
      state.lastPhaseSignalValid,
      state.lastPhaseChanged,
      state.phaseStaleBeats,
      staleRelax
    );

    let phaseCouplingAvailablePairs = 0;
    for (let i = 0; i < config.PHASE_COUPLING_PAIRS.length; i++) {
      if (phasePairStates[config.PHASE_COUPLING_PAIRS[i]] === 'available') phaseCouplingAvailablePairs++;
    }
    const phaseCouplingCoverage = config.PHASE_COUPLING_PAIRS.length > 0
      ? phaseCouplingAvailablePairs / config.PHASE_COUPLING_PAIRS.length
      : 0;

    let varTotal = 0;
    for (let d = 0; d < config.N_COMPOSITIONAL_DIMS; d++) varTotal += stats.variance[d];
    const varRatios = new Array(config.N_COMPOSITIONAL_DIMS);
    for (let d = 0; d < config.N_COMPOSITIONAL_DIMS; d++) {
      varRatios[d] = varTotal > 1e-12 ? stats.variance[d] / varTotal : 1 / config.N_COMPOSITIONAL_DIMS;
    }

    const rawRegime = regimeClassifier.classify(avgVelocity, avgCurvature, effDim, coupling.strength);
    const regime = regimeClassifier.resolve(rawRegime, state.analysisTick);
    const grade = regimeClassifier.grade(regime);

    state.lastSnapshot = {
      velocity: m.round(avgVelocity * 10000) / 10000,
      curvature: m.round(avgCurvature * 1000) / 1000,
      effectiveDimensionality: m.round(effDim * 100) / 100,
      couplingStrength: m.round(coupling.strength * 1000) / 1000,
      regime,
      grade,
      couplingMatrix: coupling.matrix,
      couplingLabels: (() => {
        const labels = {};
        // R23 E3: Regime-aware label threshold. Coherent correlations are moderate
        // not extreme, so lower threshold there. Exploring correlations are noisy,
        // requiring a stronger signal to merit a semantic label.
        const LABEL_THRESHOLD = regime === 'coherent' ? 0.28 : regime === 'exploring' ? 0.42 : 0.35;
        const LABEL_MAP = {
          'density-tension': ['+', 'tension-drives-density', '-', 'tension-suppresses-density'],
          'density-flicker': ['+', 'rhythmic-shimmer', '-', 'stability-amid-density'],
          'density-entropy': ['+', 'chaotic-proliferation', '-', 'ordered-density'],
          'tension-flicker': ['+', 'agitated-tension', '-', 'smooth-tension'],
          'tension-entropy': ['+', 'exploratory-tension', '-', 'focused-tension'],
          'flicker-entropy': ['+', 'chaotic-shimmer', '-', 'stable-variety'],
          'density-phase': ['+', 'phase-aligned-density', '-', 'phase-opposed-density'],
          'tension-phase': ['+', 'phase-aligned-tension', '-', 'phase-opposed-tension'],
          'flicker-phase': ['+', 'phase-coupled-flicker', '-', 'phase-opposed-flicker'],
          'entropy-phase': ['+', 'phase-coupled-entropy', '-', 'phase-opposed-entropy'],
          'entropy-trust': ['+', 'trust-coupled-entropy', '-', 'trust-opposed-entropy'],
        };
        if (coupling.matrix) {
          const keys = Object.keys(coupling.matrix);
          for (let li = 0; li < keys.length; li++) {
            const k = keys[li];
            const v = coupling.matrix[k];
            if (m.abs(v) >= LABEL_THRESHOLD && LABEL_MAP[k]) {
              labels[k] = v > 0 ? LABEL_MAP[k][1] : LABEL_MAP[k][3];
            }
          }
        }
        return labels;
      })(),
      compositionalVariance: varRatios,
      entropyAmplification: m.round(entropyAmplificationController.getAmp() * 100) / 100,
      entropySampleErrors: state.entropySampleErrors,
      entropyRhythmErrors: entropyRegulator.getRhythmErrors(),
      lastEntropyError: state.lastEntropyError,
      phaseValue: state.lastPhaseSample !== null ? Number(state.lastPhaseSample.toFixed(4)) : 0,
      phaseDelta: Number(state.lastPhaseDelta.toFixed(4)),
      phaseChanged: state.lastPhaseChanged,
      phaseStaleBeats: state.phaseStaleBeats,
      phaseSignalValid: state.lastPhaseSignalValid,
      phaseCouplingCoverage: Number(phaseCouplingCoverage.toFixed(4)),
      phaseCouplingAvailablePairs,
      phaseCouplingMissingPairs: config.PHASE_COUPLING_PAIRS.length - phaseCouplingAvailablePairs,
      phasePairStates,
      profilerTick: state.analysisTick,
      regimeTick: state.analysisTick,
      trajectorySamples: state.trajectory.length,
      telemetryBeatSpan,
      warmupTicksRemaining: 0,
      profilerCadence: analysisSource === 'measure-recorder' ? 'measure-recorder' : 'measure-recorder+beat-escalation',
      cadenceEscalated: analysisSource !== 'measure-recorder',
      analysisSource
    };

    explainabilityBus.emit('system-dynamics-telemetry', 'both', {
      regime,
      grade,
      velocity: state.lastSnapshot.velocity,
      curvature: state.lastSnapshot.curvature,
      effectiveDimensionality: state.lastSnapshot.effectiveDimensionality,
      couplingStrength: state.lastSnapshot.couplingStrength,
      stateVector: rawState
    }, beatStartTime);

    if (grade !== 'healthy') {
      explainabilityBus.emit('system-dynamics', 'both', {
        regime,
        grade,
        velocity: state.lastSnapshot.velocity,
        curvature: state.lastSnapshot.curvature,
        effectiveDimensionality: state.lastSnapshot.effectiveDimensionality,
        couplingStrength: state.lastSnapshot.couplingStrength
      }, beatStartTime);
    }

    return state.lastSnapshot;
  }

  return { analyze };
})();
