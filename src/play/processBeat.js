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

  // ── [stage: beat-setup] ─────────────────────────────────────────
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

  // ── [stage: intent] ───────────────────────────────────────────
  const clAbsMs = beatStartTime * 1000;
  const clIntent = SectionIntentCurves.getIntent();

  // ── [stage: entropy] ──────────────────────────────────────────
  // Blend section-shape arc (30%) with intent entropy target (70%)
  const clArcTarget = EntropyRegulator.getArcTarget(TimeStream.normalizedProgress('section'));
  EntropyRegulator.setTarget(clIntent.entropyTarget, clArcTarget);
  // CoherenceMonitor entropy signal drives regulation aggressiveness:
  // chaos → stronger regulation, stagnation → lighter touch
  EntropyRegulator.setRegulationStrength(clamp(0.5 + CoherenceMonitor.getEntropySignal() * 0.4, 0, 1));
  const clEntropy = EntropyRegulator.getRegulation();

  // ── [stage: phase] ────────────────────────────────────────────
  const clPhase = PhaseAwareCadenceWindow.update(clAbsMs, layer);

  // ── [stage: climax] ───────────────────────────────────────────
  CrossLayerClimaxEngine.tick(clAbsMs);
  const clClimaxMods = CrossLayerClimaxEngine.getModifiers(layer);
  // Stash climax modifiers for playNotesEmitPick (avoids re-calling getModifiers per pick)
  setClimaxMods(clClimaxMods);

  // ── [stage: envelope] ─────────────────────────────────────────
  CrossLayerDynamicEnvelope.tick(clAbsMs, layer);
  if (isL1) CrossLayerDynamicEnvelope.autoSelectArcType();

  // ── [stage: silhouette] ───────────────────────────────────────
  CrossLayerSilhouette.tick(clAbsMs, layer);
  const clSilhouetteCorrections = CrossLayerSilhouette.getCorrections();

  // ── [stage: rest] ─────────────────────────────────────────────
  const clRestSignals = {
    heatLevel: InteractionHeatMap.getDensity(),
    densityTarget: clIntent.densityTarget,
    phaseMode: requireNonEmptyString('RhythmicPhaseLock.getMode()', RhythmicPhaseLock.getMode())
  };
  const clRest = RestSynchronizer.evaluateSharedRest(clAbsMs, layer, clRestSignals);
  const clComplementRest = RestSynchronizer.evaluateComplementaryRest(clAbsMs, layer);

  // ── [stage: complement] ───────────────────────────────────────
  RhythmicComplementEngine.autoSelectMode(clAbsMs);

  // ── [stage: tension-cadence] ──────────────────────────────────
  const V = Validator.create('processBeat');
  const clTension = requireUnitInterval('ConductorState.compositeIntensity', ConductorState.getField('compositeIntensity'));
  const clCadence = CadenceAdvisor.shouldCadence();
  if (!clCadence || V.optionalType(clCadence, 'object') === undefined || V.optionalType(clCadence.suggest, 'boolean') === undefined) {
    throw new Error('processBeat: CadenceAdvisor.shouldCadence must return an object with boolean suggest');
  }
  const clPhaseSnapshot = { timeMs: clAbsMs, phaseDiff: clPhase.phaseDiff, mode: clPhase.mode, confidence: clPhase.confidence };

  // ── [stage: negotiation] ──────────────────────────────────────
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
  // NegotiationEngine.apply already incorporates entropyScale — do not re-apply via regulate()

  // ── [stage: probability-adjust] ───────────────────────────────
  if (clClimaxMods.playProbScale !== 1.0) playProb = clamp(playProb * clClimaxMods.playProbScale, 0, 1);
  playProb = clamp(playProb + clSilhouetteCorrections.densityBias, 0, 1);
  // Suppress shared rests during climax approach to protect musical buildup
  if (clRest.shouldRest && !CrossLayerClimaxEngine.isApproaching()) { playProb = 0; stutterProb = 0; }
  if (clComplementRest.shouldFill) playProb = clamp(playProb * (1 + clComplementRest.fillUrgency * 0.3), 0, 1);

  // Apply breathing adjustment before beat-level notes so all granularity levels use the same probabilities
  const clBreathing = InteractionHeatMap.getBreathingRecommendation();
  if (clBreathing.recommendation === 'decrease') {
    playProb = clamp(playProb * 0.96, 0, 1);
    stutterProb = clamp(stutterProb * 0.94, 0, 1);
  } else if (clBreathing.recommendation === 'increase') {
    playProb = clamp(playProb * 1.03, 0, 1);
    stutterProb = clamp(stutterProb * 1.04, 0, 1);
  }

  // ── [stage: emission] ─────────────────────────────────────────
  playNotes('beat', { playProb, stutterProb });

  // ── [stage: post-beat] ────────────────────────────────────────
  if (clRest.shouldRest) RestSynchronizer.postRest(clAbsMs, layer);

  crossLayerBeatRecord({
    layer, clAbsMs, clIntent, clPhase, clNegotiation, clBreathing,
    clTension, clCadence, clPhaseSnapshot, clRest, stutterProb, isL1
  });

  return { playProb, stutterProb };
};
