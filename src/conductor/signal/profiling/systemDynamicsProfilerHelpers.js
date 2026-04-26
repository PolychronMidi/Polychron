moduleLifecycle.declare({
  name: 'systemDynamicsProfilerHelpers',
  subsystem: 'conductor',
  deps: ['L0', 'signalReader', 'timeStream', 'validator'],
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
      // R92 E2: Regime-responsive entropy sample window. Fixed 1.0s window
      // creates uniform entropy behavior across regimes, correlating with
      // tension (pearsonR 0.3794, TE exceedance 10 beats). Coherent uses
      // narrower 0.7s window (fewer notes, more volatile entropy that
      // decorrelates from slow-changing tension), exploring uses wider 1.3s
      // (smoother, contrasting behavior). Creates regime-specific entropy
      // dynamics that break the TE coupling lock.
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
        // R67 E1: Compound phase signal. Pure section-progress ramp (0->1)
        // is monotonically increasing within each section -- a sawtooth with
        // no oscillatory character. This creates intrinsically low correlation
        // with oscillating compositional dimensions (density, tension, flicker,
        // entropy), suppressing phase axis coupling energy to ~0.08 share.
        //
        // Enrich with phrase-level nesting: blend section progress (45%) with
        // phrase progress oscillation (25%), measure progress (15%) for beat-
        // level variation, and a sinusoidal harmonic (15%).
        // R71 E2: Added measure-level component (15%) and rebalanced weights
        // to increase beat-to-beat phase variance. Phase share dropped from
        // 0.1398 to 0.1014 with the old 60/30/10 split; the measure oscillation
        // creates faster coupling opportunities with other dimensions.
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
        // R74 E3: Rebalanced phase weights -- section 0.45->0.40,
        // harmonic 0.15->0.20. Stronger harmonic oscillation creates
        // more beat-to-beat phase signal motion, keeping phase coupling
        // paths warmer and reducing stale-phase dither reliance.
        // R80 E1: Flicker-aware phase decorrelation. Use the actual flicker
        // modifier product from the conductor signal (snap.flickerProduct,
        // centered on 1.0, range ~0.87-1.14). When deflected beyond 0.05
        // from neutral, dampen the harmonic oscillation component that
        // creates flicker-phase co-movement. Replaces R79 E5 which used
        // compositionalVariance[2] (always ~0.25, making deflection zero).
        const flickerDeflection = clamp((m.abs(snap.flickerProduct - 1.0) - 0.05) / 0.10, 0, 1);
        // R82 E1: Reduce dampening 0.35->0.22. R81 phase axis share dropped
        // 0.169->0.126 because 35% dampening suppressed too much harmonic
        // oscillation (the primary source of independent phase motion).
        // 22% dampening retains anti-correlation benefit while preserving
        // enough harmonic contribution to keep phase axis share viable.
        const harmonicDampen = 1.0 - flickerDeflection * 0.22;
        const adjHarmonic = 0.20 * harmonicDampen;
        // R83 E1: Redistribute section weight to measure for phase independence.
        // Phase share declined 3 rounds (0.169->0.126->0.120) because the
        // section component (weight 0.40) correlates with density/tension via
        // section arches. Measure progress oscillates much faster, creating
        // high-frequency phase variation independent of section-level signals.
        // Section 0.40->0.32, Measure 0.15->0.23. Slack redistribution also
        // favors measure (0.45) over section (0.30) when harmonic dampens.
        const adjSection = 0.32 + (0.20 - adjHarmonic) * 0.30;
        const adjPhrase = 0.25 + (0.20 - adjHarmonic) * 0.25;
        const adjMeasure = 0.23 + (0.20 - adjHarmonic) * 0.45;
        // R84 E1: Phase independent oscillator. Phase share has declined
        // for 4 rounds (0.169->0.126->0.120->0.1137) because all phase
        // components (section/phrase/measure/harmonic) share causal inputs
        // with density/tension, creating structural correlation that
        // consumes phase energy (density-phase pearsonR=-0.5039). This LFO
        // uses absolute beat time at a frequency (0.00073) with no harmonic
        // relationship to section/phrase/measure periods, giving phase an
        // independent variance source. Weight: 8% taken from section/phrase.
        // R85 E4: Dual-frequency enrichment. Single LFO at 0.00073 creates
        // a ~72-beat period which could correlate with section length. Add a
        // second LFO at 0.00031 (~200-beat period) and blend 60/40 to create
        // a quasi-periodic pattern that resists alignment with any single
        // structural frequency.
        const phaseLfoFast = 0.5 + 0.5 * m.sin(Number(beatStartTime) * 0.00073);
        const phaseLfoSlow = 0.5 + 0.5 * m.sin(Number(beatStartTime) * 0.00031);
        const phaseLfo = phaseLfoFast * 0.6 + phaseLfoSlow * 0.4;
        // R87 E2: Phase LFO regime-responsive amplitude. Phase axis
        // share declined 0.1561->0.116 (lowest axis). During exploring/
        // evolving, phase needs more independent variance to compete
        // with density/tension/flicker axes that have regime-dependent
        // biases. Boost LFO weight: exploring 0.12, evolving 0.10,
        // coherent 0.08 (unchanged baseline).
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

    // Stale-phase dither applied BEFORE staleness detection so the
    // perturbation is visible to the change detector. This resets the
    // stale counter, keeping phase-pair coupling paths warm even when
    // normalizedProgress('section') steps only at section boundaries.
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

    // R83 E2: Trust signal variance boost. Trust axis share has been
    // persistently below fair share (0.140-0.152) because avgTrust changes
    // slowly (trust scores use slow EMAs). Amplifying the trust velocity
    // (beat-to-beat change) creates more responsive trust coupling dynamics
    // without changing the underlying trust system behavior.
    const trustDelta = avgTrust - V.optionalFinite(state.lastAvgTrust, avgTrust);
    state.lastAvgTrust = avgTrust;
    // R86 E3: Regime-responsive trust velocity amplification. During
    // exploring, trust varies more dynamically (modules activated/deactivated
    // as layer roles shift). During coherent, trust stabilizes.
    // Use higher amplification in exploring (5.0x) and evolving (4.0x)
    // to boost trust-axis coupling energy, and lower in coherent (2.5x->3.5x)
    // to prevent trust from inflating coupling during stable passages.
    // R83 E2 used flat 3.5x; trust axis fell to 0.1404 (lowest, falling).
    // R91 E1: Coherent trustVelAmp 2.5->3.5. Trust collapsed 0.1736->0.0866
    // in R90 because coherent (58.5%) dominates and 2.5x was too low.
    // Same pattern as phase recovery (R90 E5: 2.0->3.0 recovered phase +43%).
    const currentRegime = regimeClassifier.getRegime();
    const trustVelAmp = currentRegime === 'exploring' ? 5.0
      : currentRegime === 'evolving' ? 4.0
      : 3.5;
    const enhancedTrust = clamp(avgTrust + trustDelta * trustVelAmp, 0, 1);

    // R88 E1: Phase velocity amplification. Phase axis has chronically
    // declined (0.1561->0.116->0.1096 across R85-R87) despite LFO
    // adjustments. The core problem is that phase signal changes slowly
    // (section/phrase-based components). Like trust velocity amplification
    // (R83 E2), amplify phase beat-to-beat deltas to create more coupling
    // energy. This is the same pattern that saved trust axis.
    const phaseDelta = phase - V.optionalFinite(state.lastPhaseSampleForVelAmp, phase);
    state.lastPhaseSampleForVelAmp = phase;
    // R90 E5: Coherent phaseVelAmp 2.0->3.0. Phase declined again
    // (0.155->0.1156) in R89 despite R88 additions, because coherent
    // regime dominates (57.8%) and 2.0x amplification is too low
    // relative to exploring 4.0x / evolving 3.5x.
    const phaseVelAmp = currentRegime === 'exploring' ? 4.0
      : currentRegime === 'evolving' ? 3.5
      : 3.0;
    const enhancedPhase = clamp(phase + phaseDelta * phaseVelAmp, 0, 1);

    // R92 E1: Entropy velocity amplification. Entropy axis declined
    // 0.1674->0.1451 (below fair share) because entropy samples from
    // real note data and changes slowly relative to density/tension/flicker
    // which are driven by conductor signals. Same pattern that saved
    // trust (R83 E2: +31%) and phase (R88 E1: +43%). Amplify beat-to-beat
    // entropy deltas to create more coupling energy. Lower amplification
    // than trust/phase since entropy has more natural variance from note data.
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
