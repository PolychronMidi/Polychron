moduleLifecycle.declare({
  name: 'systemDynamicsProfilerHelpers',
  subsystem: 'conductor',
  deps: ['L0', 'signalReader', 'timeStream', 'validator'],
  lazyDeps: ['adaptiveTrustScores', 'conductorConfig', 'entropyAmplificationController', 'entropyMetrics', 'explainabilityBus', 'regimeClassifier'],
  provides: ['systemDynamicsProfilerHelpers'],
  init: (deps) => {
  const signalReader = deps.signalReader;
  const timeStream = deps.timeStream;
  const L0 = deps.L0;
  const V = deps.validator.create('systemDynamicsProfilerHelpers');
  function getAnalysisSettings(minWindowDefault) {
    const profile = conductorConfig.getActiveProfile();
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
      couplingLabels: {},
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
      lastAvgTrust: 0, // R83 E2: Track previous trust for velocity computation
    };
  }

  function sampleState(state) {
    const snap = signalReader.snapshot();
    let avgTrust = 0;
    let trustCount = 0;
    safePreBoot.call(() => {
      const trustSnapshot = adaptiveTrustScores.getSnapshot();
      const entries = Object.values(trustSnapshot);
      for (let i = 0; i < entries.length; i++) {
        if (entries[i] && typeof entries[i].score === 'number') {
          avgTrust += entries[i].score;
          trustCount++;
        }
      }
      if (trustCount > 0) avgTrust /= trustCount;
    });

    let entropy = 0.5;
    try {
      // Regime-responsive entropy windows decorrelate entropy from slow tension.
      const entropyRegime = regimeClassifier.getRegime();
      const entropyWindow = entropyRegime === 'exploring' ? 1.3
        : entropyRegime === 'coherent' ? 0.7
        : 1.0;
      const atwSince = beatStartTime - entropyWindow;
      const recentNotes = L0.query(L0_CHANNELS.note, { since: atwSince, windowSeconds: entropyWindow });
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
        entropyAmplificationController.adapt(state.lastSnapshot.compositionalVariance[3], entropyRegime);
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
      const sampledSectionProgress = timeStream.normalizedProgress('section');
      if (typeof sampledSectionProgress === 'number' && Number.isFinite(sampledSectionProgress)) {
        // Compound phase signal: blend section/phrase/measure progress + sine
        const sectionPart = sampledSectionProgress;
        let phrasePart = 0;
        {
          const phraseProgress = timeStream.normalizedProgress('phrase');
          if (typeof phraseProgress === 'number' && Number.isFinite(phraseProgress)) {
            phrasePart = phraseProgress;
          }
        }
        let measurePart = 0;
        {
          const measureProgress = timeStream.normalizedProgress('measure');
          if (typeof measureProgress === 'number' && Number.isFinite(measureProgress)) {
            measurePart = measureProgress;
          }
        }
        const harmonicPart = 0.5 + 0.5 * m.sin(sampledSectionProgress * m.PI * 2);
        // Flicker-aware phase decorrelation: when snap.flickerProduct
        const flickerDeflection = clamp((m.abs(snap.flickerProduct - 1.0) - 0.05) / 0.10, 0, 1);
        // 22% dampening: balances flicker-phase anti-correlation vs
        // preserving harmonic contribution to phase axis share.
        const harmonicDampen = 1.0 - flickerDeflection * 0.22;
        const adjHarmonic = 0.20 * harmonicDampen;
        // Shift phase weight from section to measure for faster independent variation.
        const adjSection = 0.32 + (0.20 - adjHarmonic) * 0.30;
        const adjPhrase = 0.25 + (0.20 - adjHarmonic) * 0.25;
        const adjMeasure = 0.23 + (0.20 - adjHarmonic) * 0.45;
        // Independent dual-frequency phase LFO resists alignment with structure.
        const phaseLfoFast = 0.5 + 0.5 * m.sin(Number(beatStartTime) * 0.00073);
        const phaseLfoSlow = 0.5 + 0.5 * m.sin(Number(beatStartTime) * 0.00031);
        const phaseLfo = phaseLfoFast * 0.6 + phaseLfoSlow * 0.4;
        // Regime-responsive LFO weight gives phase more variance outside coherent.
        const phaseRegime = regimeClassifier.getRegime();
        const lfoWeight = phaseRegime === 'exploring' ? 0.12
          : phaseRegime === 'evolving' ? 0.10
          : 0.08;
        const adjSectionFinal = adjSection * (1 - lfoWeight * 0.5);
        const adjPhraseFinal = adjPhrase * (1 - lfoWeight * 0.5);
        phase = clamp(sectionPart * adjSectionFinal + phrasePart * adjPhraseFinal + measurePart * adjMeasure + harmonicPart * adjHarmonic + phaseLfo * lfoWeight, 0, 1);
        state.lastPhaseSignalValid = true;
      }
    } catch (e) {
      console.warn('Acceptable warning: systemDynamicsProfilerHelpers: phase sampling failed:', e && e.message ? e.message : e);
    }

    // Apply stale-phase dither before staleness detection so coupling paths stay warm.
    if (state.phaseStaleBeats > 5 && state.lastPhaseSignalValid) {
      const phaseAmplitude = 0.002 + clamp((state.phaseStaleBeats - 5) / 60, 0, 1) * 0.005;
      phase = clamp(phase + ((state.phaseStaleBeats % 2 === 0) ? phaseAmplitude : -phaseAmplitude), 0, 1);
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

    // Amplify trust velocity to give slow trust EMAs usable coupling energy.
    const trustDelta = avgTrust - V.optionalFinite(state.lastAvgTrust, avgTrust);
    state.lastAvgTrust = avgTrust;
    // Regime-responsive trust velocity: higher outside coherent, 3.5x in coherent.
    const currentRegime = regimeClassifier.getRegime();
    const trustVelAmp = currentRegime === 'exploring' ? 5.0
      : currentRegime === 'evolving' ? 4.0
      : 3.5;
    const enhancedTrust = clamp(avgTrust + trustDelta * trustVelAmp, 0, 1);

    // Phase velocity amplification gives slow section/phrase signals coupling energy.
    const phaseDelta = phase - V.optionalFinite(state.lastPhaseSampleForVelAmp, phase);
    state.lastPhaseSampleForVelAmp = phase;
    // Coherent phase amplification stays lower than exploring/evolving but not inert.
    const phaseVelAmp = currentRegime === 'exploring' ? 4.0
      : currentRegime === 'evolving' ? 3.5
      : 3.0;
    const enhancedPhase = clamp(phase + phaseDelta * phaseVelAmp, 0, 1);

    // Entropy velocity amplification helps note-derived entropy compete with signals.
    const entropyDelta = entropy - V.optionalFinite(state.lastEntropySample, entropy);
    state.lastEntropySample = entropy;
    // R1 E3: Entropy velAmp boost. Entropy share collapsed 0.189->0.129
    // (-32%) in R99. Boost all tiers to recover entropy axis.
    const entropyVelAmp = currentRegime === 'exploring' ? 5.0
      : currentRegime === 'evolving' ? 4.5
      : 3.5;
    const enhancedEntropy = clamp(entropy + entropyDelta * entropyVelAmp, 0, 1);

    return [
      snap.densityProduct,
      snap.tensionProduct,
      snap.flickerProduct,
      enhancedEntropy,
      enhancedTrust,
      enhancedPhase,
    ];
  }

  return {
    emptySnapshot,
    getAnalysisSettings,
    getPhasePairStates,
    sampleState,
  };
  },
});
