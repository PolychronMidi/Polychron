// processBeat.js - Shared per-beat body for L1 and L2, extracted from main.js to eliminate duplication.

/**
 * Process one beat for the given layer. Handles setup, cross-layer orchestration,
 * post-beat recording, and trust-score updates. Returns final probabilities for micro-unit loop.
 *
 * @param {string} layer - 'L1' or 'L2'
 * @param {number} playProbIn - initial play probability for this beat
 * @param {number} stutterProbIn - initial stutter probability for this beat
 * @param {{ fxStereoPanDenominator: number, fxVelocityShiftDenominator: number, stutterPanJitterChance: number }} boot
 * @returns {{ playProb: number, stutterProb: number }}
 */
processBeat = function processBeat(layer, playProbIn, stutterProbIn, boot) {
  const isL1 = layer === 'L1';
  const { requireFiniteNumber, requireUnitInterval, requireNonEmptyString } = MainBootstrap;
  const EVENTS = EventCatalog.names;
  let playProb = playProbIn;
  let stutterProb = stutterProbIn;

  // --- Beat setup (shared, minor L1/L2 differences) ---
  if (isL1) beatCount++;
  setUnitTiming('beat');
  setOtherInstruments();
  setBinaural();
  EventBus.emit(EVENTS.BEAT_BINAURAL_APPLIED, {
    beatIndex, sectionIndex, phraseIndex, measureIndex, layer,
    freqOffset: requireFiniteNumber('binauralFreqOffset', binauralFreqOffset),
    flipBin: Boolean(flipBin)
  });
  setBalanceAndFX();
  Stutter.prepareBeat(beatStart);
  const fxStereoPan = m.abs(requireFiniteNumber('balOffset', balOffset)) / boot.fxStereoPanDenominator;
  const fxVelocityShift = m.abs(requireFiniteNumber('refVar', refVar) + requireFiniteNumber('bassVar', bassVar)) / boot.fxVelocityShiftDenominator;
  EventBus.emit(EVENTS.BEAT_FX_APPLIED, { beatIndex, sectionIndex, phraseIndex, measureIndex, layer, stereoPan: fxStereoPan, velocityShift: fxVelocityShift });
  isL1 ? playDrums() : playDrums2();
  stutterFX(flipBin ? flipBinT3 : flipBinF3);
  stutterFade(flipBin ? flipBinT3 : flipBinF3);
  rf() < boot.stutterPanJitterChance ? stutterPan(flipBin ? flipBinT3 : flipBinF3) : stutterPan(stutterPanCHs);
  Stutter.runDuePlans(beatStart);

  // --- Cross-layer orchestration ---
  const clAbsMs = beatStartTime * 1000;
  const clIntent = SectionIntentCurves.getIntent();
  // Shape entropy arc from TimeStream section progress, then override with intent target
  EntropyRegulator.setTargetFromArc(TimeStream.normalizedProgress('section'));
  EntropyRegulator.setTarget(clIntent.entropyTarget);
  // CoherenceMonitor entropy signal drives regulation aggressiveness:
  // chaos → stronger regulation, stagnation → lighter touch
  EntropyRegulator.setRegulationStrength(clamp(0.5 + CoherenceMonitor.getEntropySignal() * 0.4, 0, 1));
  const clEntropy = EntropyRegulator.getRegulation();
  const clPhase = PhaseAwareCadenceWindow.update(clAbsMs, layer);

  CrossLayerClimaxEngine.tick(clAbsMs);
  const clClimaxMods = CrossLayerClimaxEngine.getModifiers(layer);

  CrossLayerDynamicEnvelope.tick(clAbsMs, layer);
  if (isL1) CrossLayerDynamicEnvelope.autoSelectArcType();

  CrossLayerSilhouette.tick(clAbsMs);
  const clSilhouetteCorrections = CrossLayerSilhouette.getCorrections();

  const clRestSignals = {
    heatLevel: InteractionHeatMap.getDensity(),
    densityTarget: clIntent.densityTarget,
    phaseMode: requireNonEmptyString('RhythmicPhaseLock.getMode()', RhythmicPhaseLock.getMode())
  };
  const clRest = RestSynchronizer.evaluateSharedRest(clAbsMs, layer, clRestSignals);
  const clComplementRest = RestSynchronizer.evaluateComplementaryRest(clAbsMs, layer);

  RhythmicComplementEngine.autoSelectMode(clAbsMs);

  const clTension = requireUnitInterval('ConductorState.compositeIntensity', ConductorState.getField('compositeIntensity'));
  const clCadence = CadenceAdvisor.shouldCadence();
  if (!clCadence || typeof clCadence !== 'object' || typeof clCadence.suggest !== 'boolean') {
    throw new Error('processBeat: CadenceAdvisor.shouldCadence must return an object with boolean suggest');
  }
  const clPhaseSnapshot = { timeMs: clAbsMs, phaseDiff: clPhase.phaseDiff, mode: clPhase.mode, confidence: clPhase.confidence };

  const clNegotiation = NegotiationEngine.apply(layer, {
    playProb: DynamicRoleSwap.modifyPlayProb(layer, playProb),
    stutterProb,
    cadenceSuggested: Boolean(clCadence.suggest),
    phaseConfidence: clPhase.confidence,
    intent: clIntent,
    entropyScale: clEntropy.scale
  });
  playProb = clNegotiation.playProb;
  stutterProb = clNegotiation.stutterProb;
  playProb = EntropyRegulator.regulate(playProb);
  stutterProb = EntropyRegulator.regulate(stutterProb);

  if (clClimaxMods.playProbScale !== 1.0) playProb = clamp(playProb * clClimaxMods.playProbScale, 0, 1);
  playProb = clamp(playProb + clSilhouetteCorrections.densityBias, 0, 1);
  if (clRest.shouldRest) { playProb = 0; stutterProb = 0; }
  if (clComplementRest.shouldFill) playProb = clamp(playProb * (1 + clComplementRest.fillUrgency * 0.3), 0, 1);

  playNotes('beat', { playProb, stutterProb });
  if (clRest.shouldRest) RestSynchronizer.postRest(clAbsMs, layer);

  // --- Post-beat recording ---
  StutterContagion.postStutter(clAbsMs, layer, clamp(stutterProb, 0, 1), flipBin ? flipBinT3 : flipBinF3, 'fade');
  StutterContagion.apply(clAbsMs, layer);
  const clDensity = TemporalGravity.measureDensity(layer, beatStartTime);
  TemporalGravity.postDensity(clAbsMs, layer, clDensity);
  const clFeedback = FeedbackOscillator.applyFeedback(clAbsMs, layer);
  if (!clFeedback || typeof clFeedback !== 'object') throw new Error('processBeat: FeedbackOscillator.applyFeedback must return an object');
  const clFeedbackEnergy = requireUnitInterval('FeedbackOscillator.applyFeedback.energy', clFeedback.energy);

  const clCadenceGate = PhaseAwareCadenceWindow.shouldAllowCadence(clAbsMs, layer, Boolean(clCadence.suggest), clPhaseSnapshot);
  CadenceAlignment.postTension(clAbsMs, layer, clTension, clCadence.suggest);
  const clCadResult = (clCadenceGate && clNegotiation.allowCadence)
    ? CadenceAlignment.applyAlignment(clAbsMs, layer, clTension)
    : null;
  if (clCadResult) FeedbackOscillator.inject(clAbsMs, layer, clamp(clTension, 0, 1), 'cadence');

  const tpBeatVal = requireFiniteNumber('tpBeat', tpBeat);
  const tpSecVal = requireFiniteNumber('tpSec', tpSec);
  if (tpBeatVal <= 0 || tpSecVal <= 0) throw new Error(`processBeat: tpBeat and tpSec must be > 0 (tpBeat=${tpBeatVal}, tpSec=${tpSecVal})`);
  RhythmicPhaseLock.postBeat(clAbsMs, layer, (tpBeatVal / tpSecVal) * 1000);
  const clPhaseMode = RhythmicPhaseLock.getMode();

  SpectralComplementarity.postSpectralState(clAbsMs, layer);

  // --- Interaction heat map ---
  InteractionHeatMap.record('stutterContagion', clamp(stutterProb, 0, 1));
  InteractionHeatMap.record('temporalGravity', clDensity);
  InteractionHeatMap.record('cadenceAlignment', clCadResult ? 0.8 : 0);
  InteractionHeatMap.record('phaseLock', clPhaseMode === 'lock' ? 1 : 0);
  InteractionHeatMap.record('feedbackOscillator', clFeedbackEnergy);
  InteractionHeatMap.record('roleSwap', DynamicRoleSwap.getIsSwapped() ? 0.8 : 0);

  const clConvergenceIntensity = ConvergenceDetector.wasRecent(clAbsMs, layer, 300) ? 1 : 0;
  InteractionHeatMap.record('convergence', clConvergenceIntensity);
  // Gate convergence reactions through NegotiationEngine to prevent triple-stacking
  const clConvergenceGate = clConvergenceIntensity > 0
    ? NegotiationEngine.gateConvergence(layer)
    : { allowHarmonicTrigger: false, allowDownbeat: false };
  if (clConvergenceGate.allowHarmonicTrigger) ConvergenceHarmonicTrigger.onConvergence({ rarity: 0.5, absTimeMs: clAbsMs, layer });
  InteractionHeatMap.record('climaxEngine', CrossLayerClimaxEngine.isApproaching() ? clamp(CrossLayerClimaxEngine.getClimaxLevel(), 0, 1) : 0);
  InteractionHeatMap.record('restSync', clRest.shouldRest ? 0.9 : 0);

  // --- Emergent downbeat ---
  const edSignals = {
    convergence: clConvergenceGate.allowDownbeat,
    cadenceAlign: Boolean(clCadResult && clCadResult.shouldResolve),
    velReinforce: false,
    phaseLock: clPhaseMode === 'lock'
  };
  const clDownbeat = EmergentDownbeat.applyIfDownbeat(clAbsMs, layer, edSignals, 0, velocity);
  InteractionHeatMap.record('emergentDownbeat', clDownbeat ? clamp(clDownbeat.strength, 0, 1) : 0);
  if (clDownbeat) FeedbackOscillator.inject(clAbsMs, layer, clamp(clDownbeat.strength, 0, 1), 'downbeat');

  // --- Breathing ---
  const clBreathing = InteractionHeatMap.getBreathingRecommendation();
  if (clBreathing.recommendation === 'decrease') {
    playProb = clamp(playProb * 0.96, 0, 1);
    stutterProb = clamp(stutterProb * 0.94, 0, 1);
  } else if (clBreathing.recommendation === 'increase') {
    playProb = clamp(playProb * 1.03, 0, 1);
    stutterProb = clamp(stutterProb * 1.04, 0, 1);
  }

  // --- Trust scores ---
  const stutterOutcome = clamp(1 - Math.abs(stutterProb - clIntent.interactionTarget) * 2, -1, 1);
  const phaseOutcome = clamp((clPhaseMode === 'lock' ? 0.5 : clPhaseMode === 'drift' ? 0.15 : -0.4) + clPhase.confidence * 0.35, -1, 1);
  const cadenceOutcome = clCadResult
    ? (clCadResult.shouldResolve ? 0.85 : 0.35)
    : (clCadenceGate ? -0.1 : -0.25);
  const feedbackOutcome = clamp(clFeedbackEnergy - 0.2 + (clDownbeat ? clDownbeat.strength * 0.15 : 0), -1, 1);
  AdaptiveTrustScores.registerOutcome('stutterContagion', stutterOutcome);
  AdaptiveTrustScores.registerOutcome('phaseLock', phaseOutcome);
  AdaptiveTrustScores.registerOutcome('cadenceAlignment', cadenceOutcome);
  AdaptiveTrustScores.registerOutcome('feedbackOscillator', feedbackOutcome);
  // CoherenceMonitor: bias near 1.0 = coherent (positive), far from 1.0 = correcting (negative)
  const coherenceOutcome = clamp(1 - Math.abs(CoherenceMonitor.getDensityBias() - 1.0) * 4, -1, 1);
  AdaptiveTrustScores.registerOutcome('coherenceMonitor', coherenceOutcome);
  AdaptiveTrustScores.decayAll(0.002);

  // --- Explainability ---
  ExplainabilityBus.emit('beat-decision', layer, {
    intent: clIntent,
    phaseConfidence: clPhase.confidence,
    cadenceGate: clCadenceGate,
    negotiation: clNegotiation,
    breathing: clBreathing.recommendation
  }, clAbsMs);

  // --- Beat key handling (L1 defers, L2 flushes pair + telemetry) ---
  const clBeatKey = `${sectionIndex}:${phraseIndex}:${measureIndex}:${beatIndex}`;
  if (isL1) {
    InteractionHeatMap.deferBeat(clBeatKey);
  } else {
    InteractionHeatMap.flushBeatPair(clAbsMs, clBeatKey);

    // L2 telemetry emission (every 8th beat)
    if (((measureIndex * numerator + beatIndex) % 8) === 0) {
      ExplainabilityBus.emit('crosslayer-telemetry', 'both', {
        intent: SectionIntentCurves.getLastIntent(),
        heat: InteractionHeatMap.getSystemHeat(),
        trend: InteractionHeatMap.getTrend(),
        trust: AdaptiveTrustScores.getSnapshot(),
        silhouette: CrossLayerSilhouette.getSilhouette(),
        climaxLevel: CrossLayerClimaxEngine.getClimaxLevel(),
        rhythmicMode: RhythmicComplementEngine.getMode(),
        textureDistance: TexturalMirror.getTextureDistance(),
        pitchMemories: PitchMemoryRecall.getMemoryCount()
      }, clAbsMs);
    }
  }

  return { playProb, stutterProb };
};
