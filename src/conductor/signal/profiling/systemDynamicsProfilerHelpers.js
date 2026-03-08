systemDynamicsProfilerHelpers = (() => {
  function getAnalysisSettings(minWindowDefault) {
    let profile = null;
    try {
      profile = conductorConfig.getActiveProfile();
    } catch {
      profile = null;
    }
    const analysis = profile && typeof profile.analysis === 'object' ? profile.analysis : null;
    const configuredWarmup = analysis && Number.isFinite(analysis.warmupTicks)
      ? m.round(analysis.warmupTicks)
      : minWindowDefault;
    const configuredReuse = analysis && Number.isFinite(analysis.snapshotReuseBeats)
      ? m.round(analysis.snapshotReuseBeats)
      : 3;
    const shortRunCompression = Number.isFinite(totalSections) && totalSections > 0 && totalSections <= 5 ? 1 : 0;
    return {
      warmupTicks: clamp(configuredWarmup - shortRunCompression, 3, 10),
      snapshotReuseBeats: clamp(configuredReuse, 1, 8),
    };
  }

  function getPhasePairStates(matrix, phaseCouplingPairs, phaseSignalValid, phaseChanged, phaseStaleBeats, phaseStalePairThreshold) {
    const states = {};
    const phaseSignalStale = phaseSignalValid && !phaseChanged && phaseStaleBeats >= phaseStalePairThreshold;
    for (let i = 0; i < phaseCouplingPairs.length; i++) {
      const pair = phaseCouplingPairs[i];
      const value = matrix && Object.prototype.hasOwnProperty.call(matrix, pair)
        ? matrix[pair]
        : undefined;
      if (typeof value === 'number' && Number.isFinite(value)) states[pair] = phaseSignalStale ? 'stale' : 'available';
      else if (typeof value === 'number' && Number.isNaN(value)) states[pair] = phaseSignalStale ? 'stale-gated' : 'variance-gated';
      else states[pair] = 'missing';
    }
    return states;
  }

  function emptySnapshot(nCompositionalDims, minWindowDefault, phaseCouplingPairs) {
    return {
      velocity: 0,
      curvature: 0,
      effectiveDimensionality: nCompositionalDims,
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
      phaseCouplingMissingPairs: phaseCouplingPairs.length,
      phasePairStates: {
        'density-phase': 'warmup',
        'tension-phase': 'warmup',
        'flicker-phase': 'warmup',
        'entropy-phase': 'warmup',
      },
      profilerTick: 0,
      regimeTick: 0,
      trajectorySamples: 0,
      telemetryBeatSpan: 1,
      warmupTicksRemaining: minWindowDefault,
      profilerCadence: 'measure-recorder',
      cadenceEscalated: false,
      analysisSource: 'measure-recorder',
    };
  }

  function sampleState(state) {
    const snap = signalReader.snapshot();
    let avgTrust = 0;
    let trustCount = 0;
    try {
      const trustSnapshot = adaptiveTrustScores.getSnapshot();
      const entries = Object.values(trustSnapshot);
      for (let i = 0; i < entries.length; i++) {
        if (entries[i] && typeof entries[i].score === 'number') {
          avgTrust += entries[i].score;
          trustCount++;
        }
      }
      if (trustCount > 0) avgTrust /= trustCount;
    } catch {
      void 0;
    }

    let entropy = 0.5;
    try {
      const atwSince = beatStartTime - 1.0;
      const recentNotes = absoluteTimeWindow.getNotes({ since: atwSince, windowSeconds: 1.0 });
      if (recentNotes.length >= 3) {
        const midis = new Array(recentNotes.length);
        const velocities = new Array(recentNotes.length);
        for (let i = 0; i < recentNotes.length; i++) {
          midis[i] = recentNotes[i].midi;
          velocities[i] = recentNotes[i].velocity;
        }
        const pitchEntropy = entropyMetrics.pitchEntropy(midis);
        const velocityEntropy = entropyMetrics.velocityVariance(velocities);
        let rhythmEntropy = 0;
        const iois = [];
        for (let i = 1; i < recentNotes.length; i++) {
          const delta = recentNotes[i].time - recentNotes[i - 1].time;
          if (delta > 0) iois.push(delta);
        }
        if (iois.length >= 2) {
          const ioiMean = iois.reduce((sum, value) => sum + value, 0) / iois.length;
          const ioiStd = m.sqrt(iois.reduce((sum, value) => sum + (value - ioiMean) * (value - ioiMean), 0) / iois.length);
          rhythmEntropy = clamp(ioiStd / m.max(ioiMean, 0.001), 0, 1);
        }
        const combined = pitchEntropy * 0.4 + velocityEntropy * 0.3 + rhythmEntropy * 0.3;
        entropyAmplificationController.adapt(state.lastSnapshot.compositionalVariance[3]);
        entropy = 0.5 + (combined - 0.5) * entropyAmplificationController.getAmp();
      }
    } catch (error) {
      state.entropySampleErrors++;
      state.lastEntropyError = error && error.message ? error.message : 'unknown';
      explainabilityBus.emit('entropy-sample-error', 'both', {
        error: state.lastEntropyError,
        errorCount: state.entropySampleErrors,
      });
    }

    let phase = 0;
    state.lastPhaseSignalValid = false;
    state.lastPhaseChanged = false;
    state.lastPhaseDelta = 0;
    try {
      const sampledPhase = timeStream.normalizedProgress('section');
      if (typeof sampledPhase === 'number' && Number.isFinite(sampledPhase)) {
        phase = clamp(sampledPhase, 0, 1);
        state.lastPhaseSignalValid = true;
      }
    } catch {
      void 0;
    }

    if (state.lastPhaseSignalValid) {
      if (state.lastPhaseSample !== null) {
        state.lastPhaseDelta = m.abs(phase - state.lastPhaseSample);
        state.lastPhaseChanged = state.lastPhaseDelta > 0.0005;
        state.phaseStaleBeats = state.lastPhaseChanged ? 0 : state.phaseStaleBeats + 1;
      } else {
        state.phaseStaleBeats = 0;
      }
      state.lastPhaseSample = phase;
    } else {
      state.phaseStaleBeats++;
    }

    if (state.phaseStaleBeats > 25 && state.lastPhaseSignalValid) {
      const phaseAmplitude = 0.008 + clamp((state.phaseStaleBeats - 25) / 120, 0, 1) * 0.012;
      phase = clamp(phase + ((state.phaseStaleBeats % 2 === 0) ? phaseAmplitude : -phaseAmplitude), 0, 1);
    }

    return [
      snap.densityProduct,
      snap.tensionProduct,
      snap.flickerProduct,
      entropy,
      avgTrust,
      phase,
    ];
  }

  return {
    emptySnapshot,
    getAnalysisSettings,
    getPhasePairStates,
    sampleState,
  };
})();
