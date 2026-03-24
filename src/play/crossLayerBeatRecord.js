// crossLayerBeatRecord.js - Post-beat cross-layer outcome recording.
// Handles all outcome tracking, heatmap updates, trust scoring, explainability,
// and beat-pair telemetry after beat-level notes have been emitted.
// Extracted from processBeat.js to keep that file under 200 lines.

/**
 * Record all cross-layer outcomes for one beat.
 * @param {{ layer: string, clAbsMs: number, clIntent: any, clPhase: any, clNegotiation: any,
 *           clBreathing: any, clTension: number, clCadence: any, clPhaseSnapshot: any,
 *           clRest: any, clEntropy: any, stutterProb: number, isL1: boolean,
 *           outputLoadGuard?: any,
 *           stageTiming: Object|null }} opts
 */
let crossLayerBeatRecordTraceSnapBeatKey = '';
let crossLayerBeatRecordTraceCachedConductorSnap = null;
let crossLayerBeatRecordTraceCachedDynamicsSnap = null;
let crossLayerBeatRecordTraceCachedForcedTransitionEvent = null;
let crossLayerBeatRecordTraceCachedTrustScores = null;
let crossLayerBeatRecordTraceCachedCouplingTargets = null;
let crossLayerBeatRecordTraceCachedAxisCouplingTotals = null;
let crossLayerBeatRecordTraceCachedAxisEnergyShare = null;
let crossLayerBeatRecordTraceCachedCouplingGates = null;
let crossLayerBeatRecordTraceCachedAxisEnergyEquilibrator = null;
let crossLayerBeatRecordTraceLastL1Progress = null;
let crossLayerBeatRecordTraceLastL1TimeMs = null;
const crossLayerBeatRecordTraceLayerBeatKeys = new Set();
const crossLayerBeatRecordTraceBeatKeyCounts = {};

// Cadence alignment drought tracker: counts consecutive beats without a
// successful cadence result. After DROUGHT_THRESHOLD beats of gatedNoResult/
// ungated, the next successful fire gets a 2x payoff multiplier to accelerate
// trust recovery from the cold-start deficit.
let crossLayerBeatRecordCadenceDroughtBeats = 0;
const CADENCE_DROUGHT_THRESHOLD = 20;
let crossLayerBeatRecordRestDroughtBeats = 0;
const REST_DROUGHT_THRESHOLD = 16;

function crossLayerBeatRecordBuildProfilerTelemetry(dynamicsSnapshot) {
  if (!dynamicsSnapshot || typeof dynamicsSnapshot !== 'object') return null;
  return {
    analysisTick: propertyExtractors.extractFiniteOrDefault(dynamicsSnapshot, 'profilerTick', 0),
    regimeTick: propertyExtractors.extractFiniteOrDefault(dynamicsSnapshot, 'regimeTick', 0),
    trajectorySamples: propertyExtractors.extractFiniteOrDefault(dynamicsSnapshot, 'trajectorySamples', 0),
    telemetryBeatSpan: propertyExtractors.extractFiniteOrDefault(dynamicsSnapshot, 'telemetryBeatSpan', 1),
    warmupTicksRemaining: propertyExtractors.extractFiniteOrDefault(dynamicsSnapshot, 'warmupTicksRemaining', 0),
    cadence: propertyExtractors.extractStringOrDefault(dynamicsSnapshot, 'profilerCadence', 'unknown'),
    cadenceEscalated: Boolean(dynamicsSnapshot.cadenceEscalated),
    analysisSource: propertyExtractors.extractStringOrDefault(dynamicsSnapshot, 'analysisSource', 'unknown')
  };
}

function crossLayerBeatRecordBuildPhaseTelemetry(dynamicsSnapshot) {
  if (!dynamicsSnapshot || typeof dynamicsSnapshot !== 'object') return null;
  const phaseStaleBeats = propertyExtractors.extractFiniteOrDefault(dynamicsSnapshot, 'phaseStaleBeats', 0);
  return {
    phaseValue: propertyExtractors.extractFiniteOrDefault(dynamicsSnapshot, 'phaseValue', 0),
    phaseDelta: propertyExtractors.extractFiniteOrDefault(dynamicsSnapshot, 'phaseDelta', 0),
    phaseChanged: Boolean(dynamicsSnapshot.phaseChanged),
    phaseStaleBeats,
    phaseFreshnessEscalated: phaseStaleBeats > 8,
    phaseSignalValid: Boolean(dynamicsSnapshot.phaseSignalValid),
    phaseCouplingCoverage: propertyExtractors.extractFiniteOrDefault(dynamicsSnapshot, 'phaseCouplingCoverage', 0),
    phaseCouplingAvailablePairs: propertyExtractors.extractFiniteOrDefault(dynamicsSnapshot, 'phaseCouplingAvailablePairs', 0),
    phaseCouplingMissingPairs: propertyExtractors.extractFiniteOrDefault(dynamicsSnapshot, 'phaseCouplingMissingPairs', 0),
    pairStates: dynamicsSnapshot.phasePairStates && typeof dynamicsSnapshot.phasePairStates === 'object'
      ? dynamicsSnapshot.phasePairStates
      : null
  };
}

function crossLayerBeatRecordCompareTraceProgress(left, right) {
  if (left.section !== right.section) return left.section - right.section;
  if (left.phrase !== right.phrase) return left.phrase - right.phrase;
  if (left.measure !== right.measure) return left.measure - right.measure;
  return left.beat - right.beat;
}

function crossLayerBeatRecordValidateTraceProgress(layer, beatKey, timeMs) {
  const layerBeatKey = layer + ':' + beatKey;
  if (crossLayerBeatRecordTraceLayerBeatKeys.has(layerBeatKey)) {
    throw new Error('crossLayerBeatRecord: duplicate trace payload for ' + layerBeatKey);
  }
  crossLayerBeatRecordTraceLayerBeatKeys.add(layerBeatKey);
  crossLayerBeatRecordTraceBeatKeyCounts[beatKey] = (crossLayerBeatRecordTraceBeatKeyCounts[beatKey] || 0) + 1;
  if (crossLayerBeatRecordTraceBeatKeyCounts[beatKey] > 2) {
    throw new Error('crossLayerBeatRecord: beat key ' + beatKey + ' exceeded expected layer coverage');
  }
  if (layer !== 'L1') return;
  const currentProgress = {
    section: sectionIndex,
    phrase: phraseIndex,
    measure: measureIndex,
    beat: beatIndex
  };
  if (crossLayerBeatRecordTraceLastL1Progress && crossLayerBeatRecordCompareTraceProgress(currentProgress, crossLayerBeatRecordTraceLastL1Progress) <= 0) {
    throw new Error('crossLayerBeatRecord: non-monotonic L1 trace progress at ' + beatKey);
  }
  if (crossLayerBeatRecordTraceLastL1TimeMs !== null && Number.isFinite(timeMs) && timeMs + 0.001 < crossLayerBeatRecordTraceLastL1TimeMs) {
    throw new Error('crossLayerBeatRecord: regressive L1 trace timestamp at ' + beatKey);
  }
  crossLayerBeatRecordTraceLastL1Progress = currentProgress;
  if (Number.isFinite(timeMs)) crossLayerBeatRecordTraceLastL1TimeMs = timeMs;
}

crossLayerBeatRecord = function crossLayerBeatRecord(opts) {
  const {
    layer, clAbsMs, clIntent, clPhase, clNegotiation, clBreathing,
    clTension, clCadence, clPhaseSnapshot, clRest, clEntropy, stutterProb, isL1,
    outputLoadGuard,
    stageTiming
  } = opts;
  const { requireFiniteNumber, requireUnitInterval } = mainBootstrap;
  const clBeatKey = `${sectionIndex}:${phraseIndex}:${measureIndex}:${beatIndex}`;

  // Post-beat recording
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
    ? cadenceAlignment.applyAlignment(clAbsMs, layer, clTension, Boolean(clCadence.suggest))
    : null;
  if (clCadResult) feedbackOscillator.inject(clAbsMs, layer, clamp(clTension, 0, 1), 'cadence');

  const tpBeatVal = requireFiniteNumber('tpBeat', tpBeat);
  const tpSecVal = requireFiniteNumber('tpSec', tpSec);
  if (tpBeatVal <= 0 || tpSecVal <= 0) throw new Error(`crossLayerBeatRecord: tpBeat and tpSec must be > 0 (tpBeat=${tpBeatVal}, tpSec=${tpSecVal})`);
  rhythmicPhaseLock.postBeat(clAbsMs, layer, (tpBeatVal / tpSecVal) * 1000);
  const clPhaseMode = rhythmicPhaseLock.getMode();

  spectralComplementarity.postSpectralState(clAbsMs, layer);

  // Interaction heat map
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

  // Emergent downbeat
  const edSignals = {
    convergence: clConvergenceGate.allowDownbeat,
    cadenceAlign: Boolean(clCadResult && clCadResult.shouldResolve),
    velReinforce: false,
    phaseLock: clPhaseMode === 'lock'
  };
  const clDownbeat = emergentDownbeat.applyIfDownbeat(clAbsMs, layer, edSignals, 0, velocity);
  interactionHeatMap.record(trustSystems.heatMapSystems.EMERGENT_DOWNBEAT, clDownbeat ? clamp(clDownbeat.strength, 0, 1) : 0);
  if (clDownbeat) feedbackOscillator.inject(clAbsMs, layer, clamp(clDownbeat.strength, 0, 1), 'downbeat');

  // Trust scores (payoff constants from MAIN_LOOP_CONTROLS.trustPayoffs)
  const tp = MAIN_LOOP_CONTROLS.trustPayoffs;
  const stutterOutcome = clamp(1 - m.abs(stutterProb - clIntent.interactionTarget) * tp.stutterContagion.targetScale, -1, 1);
  const plp = tp.phaseLock;
  const phaseOutcome = clamp((clPhaseMode === 'lock' ? plp.lock : clPhaseMode === 'drift' ? plp.drift : plp.other) + clPhase.confidence * plp.confidenceScale, -1, 1);
  const cap = tp.cadenceAlignment;
  let cadenceOutcome = clCadResult
    ? (clCadResult.consensus ? cap.resolved : cap.unresolved * 0.5)
    : (clCadenceGate ? cap.gatedNoResult : cap.ungated);
  // Drought bonus: if cadenceAlignment fires after a long drought, double
  // the payoff to accelerate trust recovery from cold-start deficit.
  if (clCadResult) {
    if (crossLayerBeatRecordCadenceDroughtBeats >= CADENCE_DROUGHT_THRESHOLD) {
      cadenceOutcome = clamp(cadenceOutcome * 2.0, -1, 1);
    }
    crossLayerBeatRecordCadenceDroughtBeats = 0;
  } else {
    crossLayerBeatRecordCadenceDroughtBeats++;
  }
  const fop = tp.feedbackOscillator;
  const dynamicsSnapshot = systemDynamicsProfiler.getSnapshot();
  const velocityForFeedback = propertyExtractors.extractFiniteOrDefault(dynamicsSnapshot, 'velocity', 0);
  const velocitySupport = clamp(velocityForFeedback * 4, 0, 0.12);
  // feedbackOscillator: idle beats get readiness payoff; active gets base + energy
  const feedbackOutcome = (clFeedbackEnergy === 0 && !clDownbeat)
    ? clamp(0.12 + velocitySupport, -1, 1)
    : clamp(0.20 + clFeedbackEnergy + velocitySupport + fop.energyOffset + (clDownbeat ? clDownbeat.strength * fop.downbeatScale : 0), -1, 1);
  adaptiveTrustScores.registerOutcome(trustSystems.names.STUTTER_CONTAGION, stutterOutcome);
  adaptiveTrustScores.registerOutcome(trustSystems.names.PHASE_LOCK, phaseOutcome);
  adaptiveTrustScores.registerOutcome(trustSystems.names.CADENCE_ALIGNMENT, cadenceOutcome);
  adaptiveTrustScores.registerOutcome(trustSystems.names.FEEDBACK_OSCILLATOR, feedbackOutcome);
  // coherenceMonitor: bias near neutralBias = coherent (positive), far = correcting (negative)
  const cmp = tp.coherenceMonitor;
  const coherenceOutcome = clamp(1 - m.abs(coherenceMonitor.getDensityBias() - cmp.neutralBias) * cmp.sensitivity, -1, 1);
  adaptiveTrustScores.registerOutcome(trustSystems.names.COHERENCE_MONITOR, coherenceOutcome);
  // entropyRegulator: reward when measured entropy tracks target, penalize persistent deviation
  const entropyError = clEntropy ? m.abs(clEntropy.error) : 0;
  const entropyOutcome = clamp(1 - entropyError * 3, -1, 1);
  adaptiveTrustScores.registerOutcome(trustSystems.names.ENTROPY_REGULATOR, entropyOutcome);

  // Rest Synchronizer Weight Escalation
  // Boost reward dynamically past prior 0.8 limit up to 1.0 when rest density is high
  let restOutcome = 0.08;
  if (clRest.shouldRest) {
    const restDensityTarget = clIntent ? clIntent.densityTarget : 0.5;
    const scarcityBonus = clamp(1.0 - restDensityTarget, 0, 0.2); // rewards rests more when density is meant to be sparse
    const droughtBonus = crossLayerBeatRecordRestDroughtBeats >= REST_DROUGHT_THRESHOLD
      ? clamp((crossLayerBeatRecordRestDroughtBeats - REST_DROUGHT_THRESHOLD + 1) * 0.01, 0, 0.12)
      : 0;
    restOutcome = clamp(0.8 + scarcityBonus + droughtBonus, 0, 1.0);
    crossLayerBeatRecordRestDroughtBeats = 0;
  } else {
    crossLayerBeatRecordRestDroughtBeats++;
  }
  adaptiveTrustScores.registerOutcome(trustSystems.names.REST_SYNCHRONIZER, restOutcome);
  adaptiveTrustScores.decayAll(tp.decayRate);

  // Explainability
  explainabilityBus.emit('beat-decision', layer, {
    intent: clIntent,
    phaseConfidence: clPhase.confidence,
    cadenceGate: clCadenceGate,
    negotiation: clNegotiation,
    breathing: clBreathing.recommendation
  }, clAbsMs);

  // Visual Diagnostic Mode (--trace)
  // Emit a trace-beat event every beat (L1 and L2) for the trace drain.
  // Conductor + dynamics snapshots are identical for L1 and L2 within the
  // same beat, so cache them on the L1 pass and reuse for L2.
  if (traceDrain.isEnabled()) {
    crossLayerBeatRecordValidateTraceProgress(layer, clBeatKey, clAbsMs);
    if (crossLayerBeatRecordTraceSnapBeatKey !== clBeatKey) {
      crossLayerBeatRecordTraceCachedConductorSnap = conductorState.getSnapshot();
      crossLayerBeatRecordTraceCachedDynamicsSnap = systemDynamicsProfiler.ensureBeatAnalysis(Boolean(isL1));
      crossLayerBeatRecordTraceCachedForcedTransitionEvent = safePreBoot.call(() => regimeClassifier.consumeForcedTransitionEvent(), null);
      crossLayerBeatRecordTraceCachedTrustScores = adaptiveTrustScores.getSnapshot();
      crossLayerBeatRecordTraceCachedCouplingTargets = pipelineCouplingManager.getAdaptiveTargetSnapshot();
      crossLayerBeatRecordTraceCachedAxisCouplingTotals = pipelineCouplingManager.getAxisCouplingTotals();
      crossLayerBeatRecordTraceCachedAxisEnergyShare = pipelineCouplingManager.getAxisEnergyShare();
      crossLayerBeatRecordTraceCachedCouplingGates = pipelineCouplingManager.getCouplingGates();
      crossLayerBeatRecordTraceCachedAxisEnergyEquilibrator = safePreBoot.call(() => axisEnergyEquilibrator.getSnapshot(), null);
      crossLayerBeatRecordTraceSnapBeatKey = clBeatKey;
    }
    const profilerTelemetry = crossLayerBeatRecordBuildProfilerTelemetry(crossLayerBeatRecordTraceCachedDynamicsSnap);
    const tracePayload = {
      beatKey: clBeatKey,
      sectionIndex,
      phraseIndex,
      measureIndex,
      beatIndex,
      timeMs: clAbsMs,
      conductorSnap: crossLayerBeatRecordTraceCachedConductorSnap,
      negotiation: clNegotiation,
      trustScores: crossLayerBeatRecordTraceCachedTrustScores,
      regime: crossLayerBeatRecordTraceCachedDynamicsSnap.regime,
      couplingMatrix: crossLayerBeatRecordTraceCachedDynamicsSnap.couplingMatrix,
      phaseTelemetry: crossLayerBeatRecordBuildPhaseTelemetry(crossLayerBeatRecordTraceCachedDynamicsSnap),
      // Adaptive target state for coupling drift diagnostics
      couplingTargets: crossLayerBeatRecordTraceCachedCouplingTargets,
      // Per-axis total |r| sums for axis-centric conservation diagnostics
      axisCouplingTotals: crossLayerBeatRecordTraceCachedAxisCouplingTotals,
      // Per-axis energy share for axis-level redistribution detection
      axisEnergyShare: crossLayerBeatRecordTraceCachedAxisEnergyShare,
      // Coherence gate + floor dampening state for anti-redistribution analysis
      couplingGates: crossLayerBeatRecordTraceCachedCouplingGates,
      // Whole-system coupling homeostasis state for governor diagnostics
      couplingHomeostasis: safePreBoot.call(() => couplingHomeostasis.getState(), null),
      // Direct snapshot bypass -- conductorState.updateFromConductor silently
      // drops state-provider fields, so axisEnergyEquilibrator never reaches snap.
      axisEnergyEquilibrator: crossLayerBeatRecordTraceCachedAxisEnergyEquilibrator,
      // Per-beat transition readiness for coherent entry diagnosis
      transitionReadiness: safePreBoot.call(() => regimeClassifier.getTransitionReadiness(), null),
      profilerTelemetry,
      outputLoadGuard: outputLoadGuard || null,
      forcedTransitionEvent: crossLayerBeatRecordTraceCachedForcedTransitionEvent,
      stageTiming: stageTiming
    };
    explainabilityBus.emit('trace-beat', layer, tracePayload, clAbsMs);
    traceDrain.record(layer, tracePayload);
  }

  // Beat key handling (L1 defers, L2 flushes pair + telemetry)
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
        trust: crossLayerBeatRecordTraceSnapBeatKey === clBeatKey && crossLayerBeatRecordTraceCachedTrustScores
          ? crossLayerBeatRecordTraceCachedTrustScores
          : adaptiveTrustScores.getSnapshot(),
        silhouette: crossLayerSilhouette.getSilhouette(),
        climaxLevel: crossLayerClimaxEngine.getClimaxLevel(),
        rhythmicMode: rhythmicComplementEngine.getMode(),
        textureDistance: texturalMirror.getTextureDistance(),
        pitchMemories: pitchMemoryRecall.getMemoryCount()
      }, clAbsMs);
    }
  }
};
