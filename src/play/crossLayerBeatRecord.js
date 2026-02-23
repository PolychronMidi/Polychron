// crossLayerBeatRecord.js - Post-beat cross-layer outcome recording.
// Handles all outcome tracking, heatmap updates, trust scoring, explainability,
// and beat-pair telemetry after beat-level notes have been emitted.
// Extracted from processBeat.js to keep that file under 200 lines.

/**
 * Record all cross-layer outcomes for one beat.
 * @param {{ layer: string, clAbsMs: number, clIntent: any, clPhase: any, clNegotiation: any,
 *           clBreathing: any, clTension: number, clCadence: any, clPhaseSnapshot: any,
 *           clRest: any, stutterProb: number, isL1: boolean }} opts
 */
crossLayerBeatRecord = function crossLayerBeatRecord(opts) {
  const {
    layer, clAbsMs, clIntent, clPhase, clNegotiation, clBreathing,
    clTension, clCadence, clPhaseSnapshot, clRest, stutterProb, isL1
  } = opts;
  const { requireFiniteNumber, requireUnitInterval } = MainBootstrap;

  // --- Post-beat recording ---
  StutterContagion.postStutter(clAbsMs, layer, clamp(stutterProb, 0, 1), flipBin ? flipBinT3 : flipBinF3, 'fade');
  StutterContagion.apply(clAbsMs, layer);
  const clDensity = TemporalGravity.measureDensity(layer, beatStartTime);
  TemporalGravity.postDensity(clAbsMs, layer, clDensity);
  const clFeedback = FeedbackOscillator.applyFeedback(clAbsMs, layer);
  if (!clFeedback || typeof clFeedback !== 'object') throw new Error('crossLayerBeatRecord: FeedbackOscillator.applyFeedback must return an object');
  const clFeedbackEnergy = requireUnitInterval('FeedbackOscillator.applyFeedback.energy', clFeedback.energy);
  // Stash pitchBias for playNotesEmitPick to use (avoids double-calling FeedbackOscillator per pick)
  setFeedbackPitchBias(clFeedback.pitchBias);

  const clCadenceGate = PhaseAwareCadenceWindow.shouldAllowCadence(clAbsMs, layer, Boolean(clCadence.suggest), clPhaseSnapshot);
  CadenceAlignment.postTension(clAbsMs, layer, clTension, clCadence.suggest);
  const clCadResult = (clCadenceGate && clNegotiation.allowCadence)
    ? CadenceAlignment.applyAlignment(clAbsMs, layer, clTension)
    : null;
  if (clCadResult) FeedbackOscillator.inject(clAbsMs, layer, clamp(clTension, 0, 1), 'cadence');

  const tpBeatVal = requireFiniteNumber('tpBeat', tpBeat);
  const tpSecVal = requireFiniteNumber('tpSec', tpSec);
  if (tpBeatVal <= 0 || tpSecVal <= 0) throw new Error(`crossLayerBeatRecord: tpBeat and tpSec must be > 0 (tpBeat=${tpBeatVal}, tpSec=${tpSecVal})`);
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
  const triggerCountBefore = ConvergenceHarmonicTrigger.getTriggerCount();
  if (clConvergenceGate.allowHarmonicTrigger) ConvergenceHarmonicTrigger.onConvergence({ rarity: 0.5, absTimeMs: clAbsMs, layer, alignment: clCadResult });
  const convergenceTriggered = ConvergenceHarmonicTrigger.getTriggerCount() > triggerCountBefore;
  AdaptiveTrustScores.registerOutcome('convergence', convergenceTriggered ? 0.5 : (clConvergenceIntensity > 0 ? -0.1 : 0));
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

  // --- Trust scores (payoff constants from MAIN_LOOP_CONTROLS.trustPayoffs) ---
  const tp = MAIN_LOOP_CONTROLS.trustPayoffs;
  const stutterOutcome = clamp(1 - Math.abs(stutterProb - clIntent.interactionTarget) * tp.stutterContagion.targetScale, -1, 1);
  const plp = tp.phaseLock;
  const phaseOutcome = clamp((clPhaseMode === 'lock' ? plp.lock : clPhaseMode === 'drift' ? plp.drift : plp.other) + clPhase.confidence * plp.confidenceScale, -1, 1);
  const cap = tp.cadenceAlignment;
  const cadenceOutcome = clCadResult
    ? (clCadResult.shouldResolve ? cap.resolved : cap.unresolved)
    : (clCadenceGate ? cap.gatedNoResult : cap.ungated);
  const fop = tp.feedbackOscillator;
  const feedbackOutcome = clamp(clFeedbackEnergy + fop.energyOffset + (clDownbeat ? clDownbeat.strength * fop.downbeatScale : 0), -1, 1);
  AdaptiveTrustScores.registerOutcome('stutterContagion', stutterOutcome);
  AdaptiveTrustScores.registerOutcome('phaseLock', phaseOutcome);
  AdaptiveTrustScores.registerOutcome('cadenceAlignment', cadenceOutcome);
  AdaptiveTrustScores.registerOutcome('feedbackOscillator', feedbackOutcome);
  // CoherenceMonitor: bias near neutralBias = coherent (positive), far = correcting (negative)
  const cmp = tp.coherenceMonitor;
  const coherenceOutcome = clamp(1 - Math.abs(CoherenceMonitor.getDensityBias() - cmp.neutralBias) * cmp.sensitivity, -1, 1);
  AdaptiveTrustScores.registerOutcome('coherenceMonitor', coherenceOutcome);
  AdaptiveTrustScores.decayAll(tp.decayRate);

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
};
