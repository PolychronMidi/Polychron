// crossLayerBeatRecord.js - Post-beat cross-layer outcome recording.
// Handles all outcome tracking, heatmap updates, trust scoring, explainability,
// and beat-pair telemetry after beat-level notes have been emitted.
// Extracted from processBeat.js to keep that file under 200 lines.

/**
 * Record all cross-layer outcomes for one beat.
 * @param {{ layer: string, clAbsMs: number, clIntent: any, clPhase: any, clNegotiation: any,
 *           clBreathing: any, clTension: number, clCadence: any, clPhaseSnapshot: any,
 *           clRest: any, clEntropy: any, stutterProb: number, isL1: boolean,
 *           stageTiming: Object|null }} opts
 */
const _traceEnabled = process.argv.includes('--trace');
let _traceSnapBeatCount = -1;
let _traceCachedConductorSnap = null;
let _traceCachedDynamicsSnap = null;

// Cadence alignment drought tracker: counts consecutive beats without a
// successful cadence result. After DROUGHT_THRESHOLD beats of gatedNoResult/
// ungated, the next successful fire gets a 2x payoff multiplier to accelerate
// trust recovery from the cold-start deficit.
let _cadenceDroughtBeats = 0;
const CADENCE_DROUGHT_THRESHOLD = 20;

crossLayerBeatRecord = function crossLayerBeatRecord(opts) {
  const {
    layer, clAbsMs, clIntent, clPhase, clNegotiation, clBreathing,
    clTension, clCadence, clPhaseSnapshot, clRest, clEntropy, stutterProb, isL1,
    stageTiming
  } = opts;
  const { requireFiniteNumber, requireUnitInterval } = mainBootstrap;

  // --- Post-beat recording ---
  stutterContagion.postStutter(clAbsMs, layer, clamp(stutterProb, 0, 1), flipBin ? flipBinT3 : flipBinF3, 'fade');
  stutterContagion.apply(clAbsMs, layer);
  const clDensity = temporalGravity.measureDensity(layer, beatStartTime);
  temporalGravity.postDensity(clAbsMs, layer, clDensity);
  const clFeedback = feedbackOscillator.applyFeedback(clAbsMs, layer);
  if (!clFeedback || typeof clFeedback !== 'object') throw new Error('crossLayerBeatRecord: feedbackOscillator.applyFeedback must return an object');
  const clFeedbackEnergy = requireUnitInterval('feedbackOscillator.applyFeedback.energy', clFeedback.energy);
  // Stash pitchBias for playNotesEmitPick to use (avoids double-calling feedbackOscillator per pick)
  setFeedbackPitchBias(clFeedback.pitchBias);

  const clCadenceGate = phaseAwareCadenceWindow.shouldAllowCadence(clAbsMs, layer, Boolean(clCadence.suggest), clPhaseSnapshot);
  cadenceAlignment.postTension(clAbsMs, layer, clTension, clCadence.suggest);
  const clCadResult = (clCadenceGate && clNegotiation.allowCadence)
    ? cadenceAlignment.applyAlignment(clAbsMs, layer, clTension)
    : null;
  if (clCadResult) feedbackOscillator.inject(clAbsMs, layer, clamp(clTension, 0, 1), 'cadence');

  const tpBeatVal = requireFiniteNumber('tpBeat', tpBeat);
  const tpSecVal = requireFiniteNumber('tpSec', tpSec);
  if (tpBeatVal <= 0 || tpSecVal <= 0) throw new Error(`crossLayerBeatRecord: tpBeat and tpSec must be > 0 (tpBeat=${tpBeatVal}, tpSec=${tpSecVal})`);
  rhythmicPhaseLock.postBeat(clAbsMs, layer, (tpBeatVal / tpSecVal) * 1000);
  const clPhaseMode = rhythmicPhaseLock.getMode();

  spectralComplementarity.postSpectralState(clAbsMs, layer);

  // --- Interaction heat map ---
  interactionHeatMap.record(trustSystems.heatMapSystems.STUTTER_CONTAGION, clamp(stutterProb, 0, 1));
  interactionHeatMap.record(trustSystems.heatMapSystems.TEMPORAL_GRAVITY, clDensity);
  interactionHeatMap.record(trustSystems.heatMapSystems.CADENCE_ALIGNMENT, clCadResult ? 0.8 : 0);
  interactionHeatMap.record(trustSystems.heatMapSystems.PHASE_LOCK, clPhaseMode === 'lock' ? 1 : 0);
  interactionHeatMap.record(trustSystems.heatMapSystems.FEEDBACK_OSCILLATOR, clFeedbackEnergy);
  interactionHeatMap.record(trustSystems.heatMapSystems.ROLE_SWAP, dynamicRoleSwap.getIsSwapped() ? 0.8 : 0);

  const clConvergenceIntensity = convergenceDetector.wasRecent(clAbsMs, layer, 300) ? 1 : 0;
  interactionHeatMap.record(trustSystems.heatMapSystems.CONVERGENCE, clConvergenceIntensity);
  // Gate convergence reactions through negotiationEngine to prevent triple-stacking
  const clConvergenceGate = clConvergenceIntensity > 0
    ? negotiationEngine.gateConvergence(layer)
    : { allowHarmonicTrigger: false, allowDownbeat: false };
  const triggerCountBefore = convergenceHarmonicTrigger.getTriggerCount();
  if (clConvergenceGate.allowHarmonicTrigger) convergenceHarmonicTrigger.onConvergence({ rarity: 0.5, absTimeMs: clAbsMs, layer, alignment: clCadResult });
  const convergenceTriggered = convergenceHarmonicTrigger.getTriggerCount() > triggerCountBefore;
  adaptiveTrustScores.registerOutcome(trustSystems.names.CONVERGENCE, convergenceTriggered ? 0.6 : (clConvergenceIntensity > 0 ? 0.15 : 0.20));
  interactionHeatMap.record(trustSystems.heatMapSystems.CLIMAX_ENGINE, crossLayerClimaxEngine.isApproaching() ? clamp(crossLayerClimaxEngine.getClimaxLevel(), 0, 1) : 0);
  interactionHeatMap.record(trustSystems.heatMapSystems.REST_SYNC, clRest.shouldRest ? 0.9 : 0);

  // --- Emergent downbeat ---
  const edSignals = {
    convergence: clConvergenceGate.allowDownbeat,
    cadenceAlign: Boolean(clCadResult && clCadResult.shouldResolve),
    velReinforce: false,
    phaseLock: clPhaseMode === 'lock'
  };
  const clDownbeat = emergentDownbeat.applyIfDownbeat(clAbsMs, layer, edSignals, 0, velocity);
  interactionHeatMap.record(trustSystems.heatMapSystems.EMERGENT_DOWNBEAT, clDownbeat ? clamp(clDownbeat.strength, 0, 1) : 0);
  if (clDownbeat) feedbackOscillator.inject(clAbsMs, layer, clamp(clDownbeat.strength, 0, 1), 'downbeat');

  // --- Trust scores (payoff constants from MAIN_LOOP_CONTROLS.trustPayoffs) ---
  const tp = MAIN_LOOP_CONTROLS.trustPayoffs;
  const stutterOutcome = clamp(1 - Math.abs(stutterProb - clIntent.interactionTarget) * tp.stutterContagion.targetScale, -1, 1);
  const plp = tp.phaseLock;
  const phaseOutcome = clamp((clPhaseMode === 'lock' ? plp.lock : clPhaseMode === 'drift' ? plp.drift : plp.other) + clPhase.confidence * plp.confidenceScale, -1, 1);
  const cap = tp.cadenceAlignment;
  let cadenceOutcome = clCadResult
    ? (clCadResult.shouldResolve ? cap.resolved : cap.unresolved)
    : (clCadenceGate ? cap.gatedNoResult : cap.ungated);
  // Drought bonus: if cadenceAlignment fires after a long drought, double
  // the payoff to accelerate trust recovery from cold-start deficit.
  if (clCadResult) {
    if (_cadenceDroughtBeats >= CADENCE_DROUGHT_THRESHOLD) {
      cadenceOutcome = clamp(cadenceOutcome * 2.0, -1, 1);
    }
    _cadenceDroughtBeats = 0;
  } else {
    _cadenceDroughtBeats++;
  }
  const fop = tp.feedbackOscillator;
  // feedbackOscillator: idle beats get readiness payoff; active gets base + energy
  const feedbackOutcome = (clFeedbackEnergy === 0 && !clDownbeat)
    ? 0.12
    : clamp(0.20 + clFeedbackEnergy + fop.energyOffset + (clDownbeat ? clDownbeat.strength * fop.downbeatScale : 0), -1, 1);
  adaptiveTrustScores.registerOutcome(trustSystems.names.STUTTER_CONTAGION, stutterOutcome);
  adaptiveTrustScores.registerOutcome(trustSystems.names.PHASE_LOCK, phaseOutcome);
  adaptiveTrustScores.registerOutcome(trustSystems.names.CADENCE_ALIGNMENT, cadenceOutcome);
  adaptiveTrustScores.registerOutcome(trustSystems.names.FEEDBACK_OSCILLATOR, feedbackOutcome);
  // coherenceMonitor: bias near neutralBias = coherent (positive), far = correcting (negative)
  const cmp = tp.coherenceMonitor;
  const coherenceOutcome = clamp(1 - Math.abs(coherenceMonitor.getDensityBias() - cmp.neutralBias) * cmp.sensitivity, -1, 1);
  adaptiveTrustScores.registerOutcome(trustSystems.names.COHERENCE_MONITOR, coherenceOutcome);
  // entropyRegulator: reward when measured entropy tracks target, penalize persistent deviation
  const entropyError = clEntropy ? m.abs(clEntropy.error) : 0;
  const entropyOutcome = clamp(1 - entropyError * 3, -1, 1);
  adaptiveTrustScores.registerOutcome(trustSystems.names.ENTROPY_REGULATOR, entropyOutcome);
  // restSynchronizer: reward meaningful shared rests (breathing room), penalize stagnation
  const restOutcome = clRest.shouldRest ? 0.5 : 0.08;
  adaptiveTrustScores.registerOutcome(trustSystems.names.REST_SYNCHRONIZER, restOutcome);
  adaptiveTrustScores.decayAll(tp.decayRate);

  // --- Explainability ---
  explainabilityBus.emit('beat-decision', layer, {
    intent: clIntent,
    phaseConfidence: clPhase.confidence,
    cadenceGate: clCadenceGate,
    negotiation: clNegotiation,
    breathing: clBreathing.recommendation
  }, clAbsMs);

  // --- Visual Diagnostic Mode (--trace) ---
  // Emit a trace-beat event every beat (L1 and L2) for the trace drain.
  // Conductor + dynamics snapshots are identical for L1 and L2 within the
  // same beat, so cache them on the L1 pass and reuse for L2.
  if (_traceEnabled) {
    if (_traceSnapBeatCount !== beatCount) {
      _traceCachedConductorSnap = conductorState.getSnapshot();
      _traceCachedDynamicsSnap = systemDynamicsProfiler.getSnapshot();
      _traceSnapBeatCount = beatCount;
    }
    const tracePayload = {
      beatKey: `${sectionIndex}:${phraseIndex}:${measureIndex}:${beatIndex}`,
      timeMs: clAbsMs,
      conductorSnap: _traceCachedConductorSnap,
      negotiation: clNegotiation,
      trustScores: adaptiveTrustScores.getSnapshot(),
      regime: _traceCachedDynamicsSnap.regime,
      couplingMatrix: _traceCachedDynamicsSnap.couplingMatrix,
      iterBudget: setUnitTimingBudgetStats.getLastBeat(),
      stageTiming: stageTiming
    };
    explainabilityBus.emit('trace-beat', layer, tracePayload, clAbsMs);
    traceDrain.record(layer, tracePayload);
  }

  // --- Beat key handling (L1 defers, L2 flushes pair + telemetry) ---
  const clBeatKey = `${sectionIndex}:${phraseIndex}:${measureIndex}:${beatIndex}`;
  if (isL1) {
    interactionHeatMap.deferBeat(clBeatKey);
  } else {
    interactionHeatMap.flushBeatPair(clAbsMs, clBeatKey);

    // L2 telemetry emission (every 8th beat)
    if (((measureIndex * numerator + beatIndex) % 8) === 0) {
      explainabilityBus.emit('crosslayer-telemetry', 'both', {
        intent: sectionIntentCurves.getLastIntent(),
        heat: interactionHeatMap.getSystemHeat(),
        trend: interactionHeatMap.getTrend(),
        trust: adaptiveTrustScores.getSnapshot(),
        silhouette: crossLayerSilhouette.getSilhouette(),
        climaxLevel: crossLayerClimaxEngine.getClimaxLevel(),
        rhythmicMode: rhythmicComplementEngine.getMode(),
        textureDistance: texturalMirror.getTextureDistance(),
        pitchMemories: pitchMemoryRecall.getMemoryCount()
      }, clAbsMs);
    }
  }
};
