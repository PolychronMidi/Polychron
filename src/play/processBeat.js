// processBeat.js - Shared per-beat body for L1 and L2, extracted from main.js to eliminate duplication.
const V_processBeat = validator.create('processBeat');
const _PROFILE = process.argv.includes('--trace');
const _STAGE_NAMES = ['beat-setup','intent','entropy','phase','climax','envelope','silhouette','rest','complement','tension-cadence','negotiation','probability-adjust','emission','post-beat'];
const _marks = new Array(15); // 15 boundaries for 14 stages

function _getOutputLoadGuardConfig() {
  let profile = null;
  try {
    profile = conductorConfig.getActiveProfile();
  } catch {
    profile = null;
  }
  const analysis = profile && typeof profile.analysis === 'object' ? profile.analysis : null;
  return {
    windowSeconds: analysis && Number.isFinite(analysis.outputLoadWindowSeconds) ? analysis.outputLoadWindowSeconds : 1.25,
    softNotesPerSecond: analysis && Number.isFinite(analysis.outputLoadSoftNotesPerSecond) ? analysis.outputLoadSoftNotesPerSecond : 90,
    hardNotesPerSecond: analysis && Number.isFinite(analysis.outputLoadHardNotesPerSecond) ? analysis.outputLoadHardNotesPerSecond : 140,
    softScale: analysis && Number.isFinite(analysis.outputLoadSoftScale) ? analysis.outputLoadSoftScale : 0.88,
    hardScale: analysis && Number.isFinite(analysis.outputLoadHardScale) ? analysis.outputLoadHardScale : 0.72,
    softBeatCap: analysis && Number.isFinite(analysis.outputLoadSoftBeatCap) ? analysis.outputLoadSoftBeatCap : 44,
    hardBeatCap: analysis && Number.isFinite(analysis.outputLoadHardBeatCap) ? analysis.outputLoadHardBeatCap : 64
  };
}

function _mergeGuardSeverity(left, right) {
  const severityOrder = { normal: 0, soft: 1, hard: 2 };
  return severityOrder[right] > severityOrder[left] ? right : left;
}

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
  const { requireFiniteNumber, requireUnitInterval, requireNonEmptyString } = mainBootstrap;
  const EVENTS = eventCatalog.names;
  let playProb = playProbIn;
  let stutterProb = stutterProbIn;

  // -- [stage: beat-setup] -----------------------------------------
  if (_PROFILE) _marks[0] = process.hrtime.bigint();
  if (isL1) beatCount++;
  setUnitTiming('beat');
  setOtherInstruments();
  setBinaural();
  eventBus.emit(EVENTS.BEAT_BINAURAL_APPLIED, {
    beatIndex, sectionIndex, phraseIndex, measureIndex, layer,
    freqOffset: requireFiniteNumber('binauralFreqOffset', binauralFreqOffset),
    flipBin: Boolean(flipBin)
  });
  setBalanceAndFX();
  stutter.prepareBeat(beatStart);
  const fxStereoPan = m.abs(requireFiniteNumber('balOffset', balOffset)) / boot.fxStereoPanDenominator;
  const fxVelocityShift = m.abs(requireFiniteNumber('refVar', refVar) + requireFiniteNumber('bassVar', bassVar)) / boot.fxVelocityShiftDenominator;
  eventBus.emit(EVENTS.BEAT_FX_APPLIED, { beatIndex, sectionIndex, phraseIndex, measureIndex, layer, stereoPan: fxStereoPan, velocityShift: fxVelocityShift });
  isL1 ? playDrums() : playDrums2();
  stutterFX(flipBin ? flipBinT3 : flipBinF3);
  stutterFade(flipBin ? flipBinT3 : flipBinF3);
  rf() < boot.stutterPanJitterChance ? stutterPan(flipBin ? flipBinT3 : flipBinF3) : stutterPan(stutterPanCHs);
  stutter.runDuePlans(beatStart);

  // -- [stage: intent] -------------------------------------------
  if (_PROFILE) _marks[1] = process.hrtime.bigint();
  const clAbsMs = beatStartTime * 1000;
  const clIntent = sectionIntentCurves.getIntent();

  // -- [stage: entropy] ------------------------------------------
  if (_PROFILE) _marks[2] = process.hrtime.bigint();
  // Blend section-shape arc (30%) with intent entropy target (70%)
  const clArcTarget = entropyRegulator.getArcTarget(timeStream.normalizedProgress('section'));
  entropyRegulator.setTarget(clIntent.entropyTarget, clArcTarget);
  // Regulation aggressiveness scales with deviation from target entropy:
  // large deviation - stronger regulation, near-target - lighter touch.
  const entropyDeviation = m.abs(entropyRegulator.measureEntropy() - clArcTarget);
  entropyRegulator.setRegulationStrength(clamp(0.3 + entropyDeviation * 1.4, 0.2, 0.9));
  const clEntropy = entropyRegulator.getRegulation();

  // -- [stage: phase] --------------------------------------------
  if (_PROFILE) _marks[3] = process.hrtime.bigint();
  const clPhase = phaseAwareCadenceWindow.update(clAbsMs, layer);

  // -- [stage: climax] -------------------------------------------
  if (_PROFILE) _marks[4] = process.hrtime.bigint();
  crossLayerClimaxEngine.tick(clAbsMs);
  const clClimaxMods = crossLayerClimaxEngine.getModifiers(layer);
  // Stash climax modifiers for playNotesEmitPick (avoids re-calling getModifiers per pick)
  setClimaxMods(clClimaxMods);

  // -- [stage: envelope] -----------------------------------------
  if (_PROFILE) _marks[5] = process.hrtime.bigint();
  crossLayerDynamicEnvelope.tick(clAbsMs, layer);
  if (isL1) crossLayerDynamicEnvelope.autoSelectArcType();

  // -- [stage: silhouette] ---------------------------------------
  if (_PROFILE) _marks[6] = process.hrtime.bigint();
  crossLayerSilhouette.tick(clAbsMs, layer);
  const clSilhouetteCorrections = crossLayerSilhouette.getCorrections();

  // -- [stage: rest] ---------------------------------------------
  if (_PROFILE) _marks[7] = process.hrtime.bigint();
  const clRestSignals = {
    heatLevel: interactionHeatMap.getDensity(),
    densityTarget: clIntent.densityTarget,
    phaseMode: requireNonEmptyString('rhythmicPhaseLock.getMode()', rhythmicPhaseLock.getMode())
  };
  const clRest = restSynchronizer.evaluateSharedRest(clAbsMs, layer, clRestSignals);
  const clComplementRest = restSynchronizer.evaluateComplementaryRest(clAbsMs, layer);

  // -- [stage: complement] ---------------------------------------
  if (_PROFILE) _marks[8] = process.hrtime.bigint();
  rhythmicComplementEngine.autoSelectMode(clAbsMs);

  // -- [stage: tension-cadence] ----------------------------------
  if (_PROFILE) _marks[9] = process.hrtime.bigint();
  const clTension = requireUnitInterval('conductorState.compositeIntensity', conductorState.getField('compositeIntensity'));
  const clCadence = cadenceAdvisor.shouldCadence();
  V_processBeat.assertPlainObject(clCadence, 'cadenceAdvisor.shouldCadence()');
  V_processBeat.assertBoolean(clCadence.suggest, 'clCadence.suggest');
  const clPhaseSnapshot = { timeMs: clAbsMs, phaseDiff: clPhase.phaseDiff, mode: clPhase.mode, confidence: clPhase.confidence };

  // -- [stage: negotiation] --------------------------------------
  if (_PROFILE) _marks[10] = process.hrtime.bigint();
  const clNegotiation = negotiationEngine.apply(layer, {
    playProb: dynamicRoleSwap.modifyPlayProb(layer, playProb),
    stutterProb,
    cadenceSuggested: Boolean(clCadence.suggest),
    phaseConfidence: clPhase.confidence,
    intent: clIntent,
    entropyScale: clEntropy.scale
  });
  playProb = clNegotiation.playProb;
  stutterProb = clNegotiation.stutterProb;
  // negotiationEngine.apply already incorporates entropyScale - do not re-apply via regulate()

  // -- [stage: probability-adjust] -------------------------------
  if (_PROFILE) _marks[11] = process.hrtime.bigint();
  if (clClimaxMods.playProbScale !== 1.0) playProb = clamp(playProb * clClimaxMods.playProbScale, 0, 1);
  playProb = clamp(playProb + clSilhouetteCorrections.densityBias, 0, 1);
  // Suppress shared rests during climax approach to protect musical buildup
  if (clRest.shouldRest && !crossLayerClimaxEngine.isApproaching()) { playProb = 0; stutterProb = 0; }
  if (clComplementRest.shouldFill) playProb = clamp(playProb * (1 + clComplementRest.fillUrgency * 0.3), 0, 1);

  // Apply breathing adjustment before beat-level notes so all granularity levels use the same probabilities
  const clBreathing = interactionHeatMap.getBreathingRecommendation();
  if (clBreathing.recommendation === 'decrease') {
    playProb = clamp(playProb * 0.96, 0, 1);
    stutterProb = clamp(stutterProb * 0.94, 0, 1);
  } else if (clBreathing.recommendation === 'increase') {
    playProb = clamp(playProb * 1.03, 0, 1);
    stutterProb = clamp(stutterProb * 1.04, 0, 1);
  }

  const outputLoadGuardConfig = _getOutputLoadGuardConfig();
  const recentPrimaryNoteCount = absoluteTimeWindow.countNotes({ layer, windowSeconds: outputLoadGuardConfig.windowSeconds });
  const recentPrimaryNotesPerSecond = outputLoadGuardConfig.windowSeconds > 0
    ? recentPrimaryNoteCount / outputLoadGuardConfig.windowSeconds
    : recentPrimaryNoteCount;
  let outputLoadSeverity = 'normal';
  let preEmissionGuardScale = 1;
  // R60 E5: Section-adaptive guard floor. Early sections (S0-S1) use a
    // relaxed 0.45 floor for richer output; later sections (S2+) keep the
  // tighter 0.35 floor to respect wall-time budget. Self-correcting:
  // sectionIndex advances naturally via heartbeat.
    const _guardFloor = sectionIndex <= 1 ? 0.45 : 0.35;
  if (recentPrimaryNotesPerSecond >= outputLoadGuardConfig.hardNotesPerSecond) {
    preEmissionGuardScale = outputLoadGuardConfig.hardScale;
    outputLoadSeverity = 'hard';
    // R59 E1: Progressive tightening beyond hard threshold. When notes/sec
    // exceeds the hard level, continuously reduce scale proportional to the
    // excess. Self-correcting: scale eases as output drops.
    const _progressiveExcess = (recentPrimaryNotesPerSecond - outputLoadGuardConfig.hardNotesPerSecond) / m.max(1, outputLoadGuardConfig.hardNotesPerSecond);
    preEmissionGuardScale = m.max(_guardFloor, outputLoadGuardConfig.hardScale * (1 - clamp(_progressiveExcess * 0.35, 0, 0.50)));
  } else if (recentPrimaryNotesPerSecond >= outputLoadGuardConfig.softNotesPerSecond) {
    preEmissionGuardScale = outputLoadGuardConfig.softScale;
    outputLoadSeverity = 'soft';
  }
  if (preEmissionGuardScale < 1) {
    playProb = clamp(playProb * preEmissionGuardScale, 0, 1);
    stutterProb = clamp(stutterProb * m.max(0.75, preEmissionGuardScale * 0.95), 0, 1);
  }

  // -- [stage: emission] -----------------------------------------
  if (_PROFILE) _marks[12] = process.hrtime.bigint();
  const beatScheduledEvents = playNotes('beat', { playProb, stutterProb });
  const beatScheduledNotes = Number.isFinite(beatScheduledEvents) ? m.max(0, m.round(beatScheduledEvents / 2)) : 0;
  let beatGuardScale = 1;
  if (beatScheduledNotes >= outputLoadGuardConfig.hardBeatCap) {
    beatGuardScale = outputLoadGuardConfig.hardScale;
    outputLoadSeverity = _mergeGuardSeverity(outputLoadSeverity, 'hard');
    // R59 E1: Progressive beat-cap tightening. Same principle as notes/sec gate.
    // R60 E5: Uses same section-adaptive _guardFloor as pre-emission guard.
    const _beatExcess = (beatScheduledNotes - outputLoadGuardConfig.hardBeatCap) / m.max(1, outputLoadGuardConfig.hardBeatCap);
    beatGuardScale = m.max(_guardFloor, outputLoadGuardConfig.hardScale * (1 - clamp(_beatExcess * 0.35, 0, 0.50)));
  } else if (beatScheduledNotes >= outputLoadGuardConfig.softBeatCap) {
    beatGuardScale = outputLoadGuardConfig.softScale;
    outputLoadSeverity = _mergeGuardSeverity(outputLoadSeverity, 'soft');
  }
  if (beatGuardScale < 1) {
    playProb = clamp(playProb * beatGuardScale, 0, 1);
    stutterProb = clamp(stutterProb * m.max(0.75, beatGuardScale * 0.95), 0, 1);
  }

  // -- [stage: post-beat] ----------------------------------------
  if (_PROFILE) _marks[13] = process.hrtime.bigint();
  if (clRest.shouldRest) restSynchronizer.postRest(clAbsMs, layer);

  // R22 E1: Per-beat homeostasis multiplier update. Coupling data is analysed
  // per-measure in the recorder pipeline; the multiplier is smoothed per-beat
  // here for responsive energy governance (~418 ticks/run vs ~78 recorder calls).
  couplingHomeostasis.tick();

  crossLayerBeatRecord({
    layer, clAbsMs, clIntent, clPhase, clNegotiation, clBreathing,
    clTension, clCadence, clPhaseSnapshot, clRest, clEntropy, stutterProb, isL1,
    outputLoadGuard: {
      windowSeconds: Number(outputLoadGuardConfig.windowSeconds.toFixed(3)),
      recentPrimaryNoteCount,
      recentPrimaryNotesPerSecond: Number(recentPrimaryNotesPerSecond.toFixed(4)),
      beatScheduledNotes,
      preEmissionScale: Number(preEmissionGuardScale.toFixed(4)),
      beatScale: Number(beatGuardScale.toFixed(4)),
      scale: Number(m.min(preEmissionGuardScale, beatGuardScale).toFixed(4)),
      severity: outputLoadSeverity,
      softNotesPerSecond: outputLoadGuardConfig.softNotesPerSecond,
      hardNotesPerSecond: outputLoadGuardConfig.hardNotesPerSecond,
      softBeatCap: outputLoadGuardConfig.softBeatCap,
      hardBeatCap: outputLoadGuardConfig.hardBeatCap
    },
    stageTiming: /** @type {Record<string, number> | null} */ (_PROFILE ? (() => { _marks[14] = process.hrtime.bigint(); const t = {}; for (let i = 0; i < 14; i++) t[_STAGE_NAMES[i]] = Number(_marks[i + 1] - _marks[i]) / 1e6; return t; })() : null)
  });

  return { playProb, stutterProb };
};
