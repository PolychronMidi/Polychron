// crossLayerBeatRecord.js - Post-beat cross-layer outcome recording.
// Handles all outcome tracking, heatmap updates, trust scoring, explainability,
// and beat-pair telemetry after beat-level notes have been emitted.
// Extracted from processBeat.js to keep that file under 200 lines.

const V = validator.create('crossLayerBeatRecord');

/**
 * Record all cross-layer outcomes for one beat.
 * @param {{ layer: string, absoluteSeconds: number, clIntent: any, clPhase: any, clNegotiation: any,
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
  if (!V.optionalType(dynamicsSnapshot, 'object')) return null;
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
  if (!V.optionalType(dynamicsSnapshot, 'object')) return null;
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
  crossLayerBeatRecordTraceBeatKeyCounts[beatKey] = (V.optionalFinite(crossLayerBeatRecordTraceBeatKeyCounts[beatKey], 0)) + 1;
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
    layer, absoluteSeconds, clIntent, clPhase, clNegotiation, clBreathing,
    clTension, clCadence, clPhaseSnapshot, clRest, clEntropy, stutterProb, isL1,
    outputLoadGuard,
    stageTiming
  } = opts;
  const { requireFiniteNumber, requireUnitInterval } = mainBootstrap;
  const clBeatKey = `${sectionIndex}:${phraseIndex}:${measureIndex}:${beatIndex}`;

  // Post-beat recording
  coordinationIndependenceManager.tick();
  trustEcologyCharacter.update();
  convergenceMemory.record(absoluteSeconds, layer);
  stutterContagion.postStutter(absoluteSeconds, layer, clamp(stutterProb, 0, 1), flipBin ? flipBinT3 : flipBinF3, 'fade');
  stutterContagion.apply(absoluteSeconds, layer);
  const clDensity = temporalGravity.measureDensity(layer, beatStartTime);
  temporalGravity.postDensity(absoluteSeconds, layer, clDensity);
  // R35: density-rhythm L0 channel for rhythm mode adaptation
  L0.post(L0_CHANNELS.densityRhythm, layer, absoluteSeconds, { density: clamp(clDensity, 0, 1) });
  // R37: perceptual crowding estimate from note density + onset clustering
  const recentNotes = L0.query(L0_CHANNELS.note, { layer, windowSeconds: 0.3 });
  const noteCount = recentNotes ? recentNotes.length : 0;
  const perceptualDensity = clamp(noteCount / 12, 0, 1);
  L0.post(L0_CHANNELS.perceptualCrowding, layer, absoluteSeconds, { perceptualDensity, noteCount });
  // Xenolinguistic L4: beat-level self-narration. The system describes what it just did.
  const selfRegime = conductorSignalBridge.getSignals().regime || 'evolving';
  const selfNarrative = (clDensity > 0.6 ? 'dense' : clDensity < 0.3 ? 'sparse' : 'balanced') + ' '
    + selfRegime + (perceptualDensity > 0.7 ? ' crowded' : '');
  L0.post(L0_CHANNELS.selfNarration, layer, absoluteSeconds, { narrative: selfNarrative, density: clDensity, regime: selfRegime });
  // Xenolinguistic L2: entanglement -- write quantum state for other layer to read
  LM.quantumState = { lastPitchClass: -1, lastDensity: clDensity, lastRegime: selfRegime, lastTexture: selfNarrative };
  // Xenolinguistic L3: channel unification. Measure alignment across 5 perceptual channels:
  // harmonic (regime), rhythmic (phase lock), binaural (implicit), spectral (brightness), micro (density).
  // High alignment = unified xenolinguistic expression. Low = fragmented channels.
  const channelHarmonic = selfRegime === 'coherent' ? 1 : selfRegime === 'exploring' ? 0 : 0.5;
  const channelRhythmic = clamp(clDensity, 0, 1);
  const channelSpectral = (() => { const se = L0.getLast(L0_CHANNELS.spectral, { layer }); return se && Array.isArray(se.histogram) ? clamp(se.histogram.reduce((a, b) => a + b, 0) / 4, 0, 1) : 0.5; })();
  const channelMicro = clamp(1 - perceptualDensity, 0, 1);
  const channels = [channelHarmonic, channelRhythmic, channelSpectral, channelMicro];
  const chMean = channels.reduce((a, b) => a + b, 0) / channels.length;
  let chVariance = 0;
  for (let chi = 0; chi < channels.length; chi++) chVariance += (channels[chi] - chMean) * (channels[chi] - chMean);
  chVariance /= channels.length;
  const channelCoherence = clamp(1 - chVariance * 4, 0, 1);
  L0.post(L0_CHANNELS.channelCoherence, layer, absoluteSeconds, { coherence: channelCoherence, mean: chMean });
  const clFeedback = feedbackOscillator.applyFeedback(absoluteSeconds, layer);
  V.assertObject(clFeedback, 'feedbackOscillator.applyFeedback result');
  const clFeedbackEnergy = requireUnitInterval('feedbackOscillator.applyFeedback.energy', clFeedback.energy);
  // Stash pitchBias and energy for playNotesEmitPick to use
  setFeedbackPitchBias(clFeedback.pitchBias);
  setFeedbackStutterEnergy(clFeedbackEnergy);

  const clCadenceGate = phaseAwareCadenceWindow.shouldAllowCadence(absoluteSeconds, layer, Boolean(clCadence.suggest), clPhaseSnapshot);
  cadenceAlignment.postTension(absoluteSeconds, layer, clTension, clCadence.suggest);
  const clCadResult = (clCadenceGate && clNegotiation.allowCadence)
    ? cadenceAlignment.applyAlignment(absoluteSeconds, layer, clTension, Boolean(clCadence.suggest))
    : null;
  if (clCadResult) feedbackOscillator.inject(absoluteSeconds, layer, clamp(clTension, 0, 1), 'cadence');

  const spBeatVal = requireFiniteNumber('spBeat', spBeat);
  if (spBeatVal <= 0) throw new Error(`crossLayerBeatRecord: spBeat must be > 0 (spBeat=${spBeatVal})`);
  rhythmicPhaseLock.postBeat(absoluteSeconds, layer, spBeatVal);
  const clPhaseMode = rhythmicPhaseLock.getMode();

  spectralComplementarity.postSpectralState(absoluteSeconds, layer);

  // R51: vertical interval collision detection -- posts to L0 and explainabilityBus
  verticalIntervalMonitor.process(absoluteSeconds, layer);

  // Interaction heat map
  interactionHeatMap.record(trustSystems.heatMapSystems.STUTTER_CONTAGION, clamp(stutterProb, 0, 1));
  interactionHeatMap.record(trustSystems.heatMapSystems.TEMPORAL_GRAVITY, clDensity);
  interactionHeatMap.record(trustSystems.heatMapSystems.CADENCE_ALIGNMENT, clCadResult ? 0.8 : 0);
  interactionHeatMap.record(trustSystems.heatMapSystems.PHASE_LOCK, clPhaseMode === 'lock' ? 1 : 0);
  interactionHeatMap.record(trustSystems.heatMapSystems.FEEDBACK_OSCILLATOR, clFeedbackEnergy);
  interactionHeatMap.record(trustSystems.heatMapSystems.ROLE_SWAP, dynamicRoleSwap.getIsSwapped() ? 0.8 : 0);
  // roleSwap payoff: reward when swap creates layer differentiation (density contrast)
  const isSwapped = dynamicRoleSwap.getIsSwapped();
  const roleSwapOutcome = isSwapped
    ? clamp(0.35 + clDensity * 0.3, 0, 0.7)
    : 0.15;
  adaptiveTrustScores.registerOutcome(trustSystems.names.ROLE_SWAP, clamp(roleSwapOutcome, -1, 1));

  const clConvergenceIntensity = convergenceDetector.wasRecent(absoluteSeconds, layer, 300) ? 1 : 0;
  interactionHeatMap.record(trustSystems.heatMapSystems.CONVERGENCE, clConvergenceIntensity);
  // Gate convergence reactions through negotiationEngine to prevent triple-stacking
  const clConvergenceGate = clConvergenceIntensity > 0
    ? negotiationEngine.gateConvergence(layer)
    : { allowHarmonicTrigger: false, allowDownbeat: false };
  const triggerCountBefore = convergenceHarmonicTrigger.getTriggerCount();
  if (clConvergenceGate.allowHarmonicTrigger) convergenceHarmonicTrigger.onConvergence({ rarity: 0.5, absoluteSeconds, layer, alignment: clCadResult });
  const convergenceTriggered = convergenceHarmonicTrigger.getTriggerCount() > triggerCountBefore;
  // Convergence payoff: momentum-aware. Climax approach boosts convergence reward.
  const convClimaxEntry = L0.getLast(L0_CHANNELS.climaxPressure, { layer: 'both' });
  const convClimaxBoost = convClimaxEntry && convClimaxEntry.level > 0.5 ? 0.10 : 0;
  adaptiveTrustScores.registerOutcome(trustSystems.names.CONVERGENCE, clamp(
    (convergenceTriggered ? 0.65 : (clConvergenceIntensity > 0 ? 0.30 : 0.12)) + convClimaxBoost, -1, 1));
  interactionHeatMap.record(trustSystems.heatMapSystems.CLIMAX_ENGINE, crossLayerClimaxEngine.isApproaching() ? clamp(crossLayerClimaxEngine.getClimaxLevel(), 0, 1) : 0);
  interactionHeatMap.record(trustSystems.heatMapSystems.REST_SYNC, clRest.shouldRest ? 0.9 : 0);

  // Emergent downbeat
  const edSignals = {
    convergence: clConvergenceGate.allowDownbeat,
    cadenceAlign: Boolean(clCadResult && clCadResult.shouldResolve),
    velReinforce: false,
    phaseLock: clPhaseMode === 'lock'
  };
  const clDownbeat = emergentDownbeat.applyIfDownbeat(absoluteSeconds, layer, edSignals, 0, velocity);
  interactionHeatMap.record(trustSystems.heatMapSystems.EMERGENT_DOWNBEAT, clDownbeat ? clamp(clDownbeat.strength, 0, 1) : 0);
  if (clDownbeat) feedbackOscillator.inject(absoluteSeconds, layer, clamp(clDownbeat.strength, 0, 1), 'downbeat');

  // R35: emergence detection -- when 3+ systems fire on same beat, boost all payoffs
  const emergenceSystems = [];
  if (stutterProb > 0.15) emergenceSystems.push('stutter');
  if (clCadResult && clCadResult.shouldResolve) emergenceSystems.push('cadence');
  if (clPhaseMode === 'lock') emergenceSystems.push('phaseLock');
  if (clFeedbackEnergy > 0.05) emergenceSystems.push('feedback');
  if (clDownbeat) emergenceSystems.push('downbeat');
  const otherLayerForEmergence = crossLayerHelpers.getOtherLayer(layer);
  const convergenceEntry = L0.getLast(L0_CHANNELS.onset, { layer: otherLayerForEmergence, since: absoluteSeconds - 0.05, windowSeconds: 0.05 });
  if (convergenceEntry) emergenceSystems.push('convergence');
  const emergenceBonus = emergenceSystems.length >= 3 ? 0.04 * (emergenceSystems.length - 2) : 0;

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
  // R35: emergence bonus applied to all active systems when 3+ fire together
  const eb = Number.isFinite(emergenceBonus) ? emergenceBonus : 0;
  adaptiveTrustScores.registerOutcome(trustSystems.names.STUTTER_CONTAGION, clamp(stutterOutcome + (emergenceSystems.includes('stutter') ? eb : 0), -1, 1));
  adaptiveTrustScores.registerOutcome(trustSystems.names.PHASE_LOCK, clamp(phaseOutcome + (emergenceSystems.includes('phaseLock') ? eb : 0), -1, 1));
  adaptiveTrustScores.registerOutcome(trustSystems.names.CADENCE_ALIGNMENT, clamp(cadenceOutcome + (emergenceSystems.includes('cadence') ? eb : 0), -1, 1));
  adaptiveTrustScores.registerOutcome(trustSystems.names.FEEDBACK_OSCILLATOR, clamp(feedbackOutcome + (emergenceSystems.includes('feedback') ? eb : 0), -1, 1));
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

  // grooveTransfer: reward when groove offset is small (layers aligned), penalize large offsets
  const grooveEntry = L0.getLast(L0_CHANNELS.grooveTransfer, { layer: layer });
  const grooveOffset = V.optionalFinite(grooveEntry ? grooveEntry.offset : NaN, 0);
  const grooveOutcome = grooveEntry ? clamp(1 - m.abs(grooveOffset) * 8, -1, 1) : 0.1;
  adaptiveTrustScores.registerOutcome(trustSystems.names.GROOVE_TRANSFER, grooveOutcome);

  // velocityInterference: reward when velocity delta between layers is moderate (contrast), penalize extremes
  const velEntry = L0.getLast(L0_CHANNELS.velocity, { layer: layer });
  const velDelta = velEntry ? m.abs(V.optionalFinite(velEntry.delta, 0)) : 0;
  const velOutcome = clamp(velDelta < 20 ? 0.3 + velDelta * 0.02 : 0.7 - (velDelta - 20) * 0.015, -1, 1);
  adaptiveTrustScores.registerOutcome(trustSystems.names.VELOCITY_INTERFERENCE, velOutcome);

  // harmonicIntervalGuard: reward consonance tracking toward dissonance target
  const dissonanceTarget = V.requireFinite(clIntent.dissonanceTarget, 'clIntent.dissonanceTarget');
  const harmonicGuardOutcome = clamp(0.3 + (1 - m.abs(clTension - dissonanceTarget)) * 0.5, -1, 1);
  adaptiveTrustScores.registerOutcome(trustSystems.names.HARMONIC_INTERVAL_GUARD, harmonicGuardOutcome);

  // emergentDownbeat: reward when downbeats fire during high convergence target, penalize during low
  const convergenceTarget = V.requireFinite(clIntent.convergenceTarget, 'clIntent.convergenceTarget');
  const downbeatOutcome = clDownbeat ? clamp(0.2 + convergenceTarget * 0.6 + clDownbeat.strength * 0.2, -1, 1) : clamp(0.1 + (1 - convergenceTarget) * 0.2, -1, 1);
  adaptiveTrustScores.registerOutcome(trustSystems.names.EMERGENT_DOWNBEAT, downbeatOutcome);

  // articulationComplement: reward active contrast/contagion (sustainScale != 1.0), penalize neutral
  const artMod = articulationComplement.getSustainModifier(layer);
  const artDeviation = m.abs(artMod.sustainScale - 1.0);
  const artOutcome = clamp(artDeviation > 0.05 ? 0.3 + artDeviation * 1.5 : 0.05, -1, 1);
  adaptiveTrustScores.registerOutcome(trustSystems.names.ARTICULATION_COMPLEMENT, artOutcome);

  // texturalMirror: regime-aware payoff. Coherent = reward mirroring (low distance),
  // exploring = reward complementing (moderate distance). Fixes conflict where R30
  // regime-mirror told it to echo in coherent but payoff penalized zero distance.
  const texDist = texturalMirror.getTextureDistance();
  const texRegime = dynamicsSnapshot ? dynamicsSnapshot.regime : 'evolving';
  const texTarget = texRegime === 'coherent' ? 0.15 : texRegime === 'exploring' ? 0.55 : 0.35;
  const texOutcome = clamp(0.5 - m.abs(texDist - texTarget) * 1.5, -0.2, 0.8);
  adaptiveTrustScores.registerOutcome(trustSystems.names.TEXTURAL_MIRROR, clamp(texOutcome + (emergenceSystems.length >= 3 ? eb : 0), -1, 1));

  // spectralComplementarity: reward active gap-filling (histogram imbalance being corrected)
  const spectralHist = spectralComplementarity.getHistogram(layer);
  const spectralOutcome = clamp(0.2 + (1 - (m.max(...spectralHist) - m.min(...spectralHist)) / m.max(1, m.max(...spectralHist))) * 0.5, -1, 1);
  adaptiveTrustScores.registerOutcome(trustSystems.names.SPECTRAL_COMPLEMENTARITY, spectralOutcome);

  // motifEcho: reward when echoes are pending or recently delivered (cross-layer imitation active)
  const echoPending = motifEcho.getPendingCount();
  const echoOutcome = clamp(echoPending > 0 ? 0.4 + m.min(echoPending, 5) * 0.08 : 0.1, -1, 1);
  adaptiveTrustScores.registerOutcome(trustSystems.names.MOTIF_ECHO, echoOutcome);

  // climaxEngine: reward when approaching climax during high-tension sections, reward release during low
  const climaxApproaching = crossLayerClimaxEngine.isApproaching();
  const climaxLevel = crossLayerClimaxEngine.getClimaxLevel();
  const climaxOutcome = climaxApproaching ? clamp(0.3 + clTension * 0.4 + climaxLevel * 0.2, -1, 1) : clamp(0.15 + (1 - clTension) * 0.3, -1, 1);
  adaptiveTrustScores.registerOutcome(trustSystems.names.CLIMAX_ENGINE, climaxOutcome);

  // dynamicEnvelope: reward when velocity scale deviates from 1.0 (envelope actively shaping)
  const envScale = crossLayerDynamicEnvelope.getVelocityScale(layer);
  const envDeviation = m.abs(envScale - 1.0);
  const envOutcome = clamp(envDeviation > 0.03 ? 0.3 + envDeviation * 2 : 0.08, -1, 1);
  adaptiveTrustScores.registerOutcome(trustSystems.names.DYNAMIC_ENVELOPE, envOutcome);

  // temporalGravity: reward when density from L0 shows moderate cross-layer alignment
  const gravDensity = L0.getLast(L0_CHANNELS.density, { layer: layer });
  const gravOutcome = gravDensity ? clamp(0.2 + V.optionalFinite(gravDensity.density, 0.5) * 0.5, -1, 1) : 0.1;
  adaptiveTrustScores.registerOutcome(trustSystems.names.TEMPORAL_GRAVITY, gravOutcome);

  // rhythmicComplement: reward when complement mode is active (not 'none')
  const rcMode = rhythmicComplementEngine.getMode();
  const rcOutcome = rcMode && rcMode !== 'free' ? clamp(0.4 + (rcMode === 'hocket' ? 0.2 : rcMode === 'antiphony' ? 0.15 : 0.1), -1, 1) : 0.08;
  adaptiveTrustScores.registerOutcome(trustSystems.names.RHYTHMIC_COMPLEMENT, rcOutcome);

  // convergenceHarmonicTrigger: reward when trigger fires during high convergence intent
  const chtTriggered = convergenceHarmonicTrigger.getTriggerCount() > 0;
  const chtOutcome = chtTriggered ? clamp(0.5 + convergenceTarget * 0.3, -1, 1) : clamp(0.1 + (1 - convergenceTarget) * 0.15, -1, 1);
  adaptiveTrustScores.registerOutcome(trustSystems.names.CONVERGENCE_HARMONIC_TRIGGER, chtOutcome);

  // registerCollisionAvoider: reward when collisions are being actively avoided (adjusted count > 0)
  const rcaEntry = L0.getLast(L0_CHANNELS.registerCollision, { layer: layer });
  const rcaOutcome = rcaEntry ? 0.35 : 0.15;
  adaptiveTrustScores.registerOutcome(trustSystems.names.REGISTER_COLLISION_AVOIDER, rcaOutcome);

  // verticalIntervalMonitor: reward when dissonance matches intent target
  const vimDissonanceError = m.abs(clTension - dissonanceTarget);
  const vimOutcome = clamp(0.5 - vimDissonanceError * 1.5, -1, 1);
  adaptiveTrustScores.registerOutcome(trustSystems.names.VERTICAL_INTERVAL_MONITOR, vimOutcome);

  // crossLayerSilhouette: reward when density corrections are active (non-zero bias)
  const silCorrections = crossLayerSilhouette.getCorrections();
  const silOutcome = silCorrections && m.abs(silCorrections.densityBias) > 0.01 ? clamp(0.3 + m.abs(silCorrections.densityBias) * 2, -1, 1) : 0.1;
  adaptiveTrustScores.registerOutcome(trustSystems.names.CROSS_LAYER_SILHOUETTE, silOutcome);

  // polyrhythmicPhasePredictor: reward based on phase confidence
  const pppOutcome = clamp(0.15 + clPhase.confidence * 0.4, -1, 1);
  adaptiveTrustScores.registerOutcome(trustSystems.names.POLYRHYTHMIC_PHASE_PREDICTOR, pppOutcome);

  // phaseAwareCadenceWindow: reward when cadence gating is meaningful
  const pacwOutcome = clCadenceGate ? clamp(0.3 + clPhase.confidence * 0.3, -1, 1) : 0.12;
  adaptiveTrustScores.registerOutcome(trustSystems.names.PHASE_AWARE_CADENCE_WINDOW, pacwOutcome);

  adaptiveTrustScores.decayAll(tp.decayRate);

  // Explainability
  explainabilityBus.emit('beat-decision', layer, {
    intent: clIntent,
    phaseConfidence: clPhase.confidence,
    cadenceGate: clCadenceGate,
    negotiation: clNegotiation,
    breathing: clBreathing.recommendation
  }, absoluteSeconds);

  // Visual Diagnostic Mode (--trace)
  // Emit a trace-beat event every beat (L1 and L2) for the trace drain.
  // Conductor + dynamics snapshots are identical for L1 and L2 within the
  // same beat, so cache them on the L1 pass and reuse for L2.
  if (traceDrain.isEnabled()) {
    crossLayerBeatRecordValidateTraceProgress(layer, clBeatKey, absoluteSeconds);
    if (crossLayerBeatRecordTraceSnapBeatKey !== clBeatKey) {
      crossLayerBeatRecordTraceCachedConductorSnap = conductorState.getSnapshot();
      crossLayerBeatRecordTraceCachedDynamicsSnap = systemDynamicsProfiler.ensureBeatAnalysis(Boolean(isL1));
      crossLayerBeatRecordTraceCachedForcedTransitionEvent = regimeClassifier.consumeForcedTransitionEvent();
      crossLayerBeatRecordTraceCachedTrustScores = adaptiveTrustScores.getSnapshot();
      crossLayerBeatRecordTraceCachedCouplingTargets = pipelineCouplingManager.getAdaptiveTargetSnapshot();
      crossLayerBeatRecordTraceCachedAxisCouplingTotals = pipelineCouplingManager.getAxisCouplingTotals();
      crossLayerBeatRecordTraceCachedAxisEnergyShare = pipelineCouplingManager.getAxisEnergyShare();
      crossLayerBeatRecordTraceCachedCouplingGates = pipelineCouplingManager.getCouplingGates();
      crossLayerBeatRecordTraceCachedAxisEnergyEquilibrator = axisEnergyEquilibrator.getSnapshot();
      crossLayerBeatRecordTraceSnapBeatKey = clBeatKey;
    }
    const profilerTelemetry = crossLayerBeatRecordBuildProfilerTelemetry(crossLayerBeatRecordTraceCachedDynamicsSnap);
    const tracePayload = {
      beatKey: clBeatKey,
      sectionIndex,
      phraseIndex,
      measureIndex,
      beatIndex,
      timeMs: absoluteSeconds,
      conductorSnap: crossLayerBeatRecordTraceCachedConductorSnap,
      negotiation: clNegotiation,
      trustScores: crossLayerBeatRecordTraceCachedTrustScores,
      regime: crossLayerBeatRecordTraceCachedDynamicsSnap.regime,
      couplingMatrix: crossLayerBeatRecordTraceCachedDynamicsSnap.couplingMatrix,
      couplingLabels: crossLayerBeatRecordTraceCachedDynamicsSnap.couplingLabels,
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
      couplingHomeostasis: couplingHomeostasis.getState(),
      // Direct snapshot bypass -- conductorState.updateFromConductor silently
      // drops state-provider fields, so axisEnergyEquilibrator never reaches snap.
      axisEnergyEquilibrator: crossLayerBeatRecordTraceCachedAxisEnergyEquilibrator,
      // Per-beat transition readiness for coherent entry diagnosis
      transitionReadiness: regimeClassifier.getTransitionReadiness(),
      profilerTelemetry,
      outputLoadGuard: outputLoadGuard || null,
      forcedTransitionEvent: crossLayerBeatRecordTraceCachedForcedTransitionEvent,
      climaxTelemetry: { level: climaxLevel, approaching: climaxApproaching, peak: crossLayerClimaxEngine.isPeak(), count: crossLayerClimaxEngine.getClimaxCount() },
      stageTiming: stageTiming
    };
    explainabilityBus.emit('trace-beat', layer, tracePayload, absoluteSeconds);
    traceDrain.record(layer, tracePayload);
  }

  // Beat key handling (L1 defers, L2 flushes pair + telemetry)
  if (isL1) {
    interactionHeatMap.deferBeat(clBeatKey);
  } else {
    interactionHeatMap.flushBeatPair(absoluteSeconds, clBeatKey);

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
      }, absoluteSeconds);
    }
  }
};
