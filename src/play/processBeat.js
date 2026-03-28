// processBeat.js - Shared per-beat body for L1 and L2, extracted from main.js to eliminate duplication.
const V_processBeat = validator.create('processBeat');
const PROFILE = process.argv.includes('--trace');
const STAGE_NAMES = ['beat-setup','intent','entropy','phase','climax','envelope','silhouette','rest','complement','tension-cadence','negotiation','probability-adjust','emission','post-beat'];
const marks = new Array(15); // 15 boundaries for 14 stages

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

  // -- [stage: beat-setup] --
  if (PROFILE) marks[0] = process.hrtime.bigint();
  if (isL1) beatCount++;
  setUnitTiming('beat');
  setOtherInstruments();
  eventBus.emit(EVENTS.BEAT_BINAURAL_APPLIED, {
    beatIndex, sectionIndex, phraseIndex, measureIndex, layer,
    freqOffset: requireFiniteNumber('binauralFreqOffset', binauralFreqOffset),
    flipBin: Boolean(flipBin)
  });
  setBalanceAndFX();
  StutterManager.prepareBeat(beatStartTime);
  const fxStereoPan = m.abs(requireFiniteNumber('balOffset', balOffset)) / boot.fxStereoPanDenominator;
  const fxVelocityShift = m.abs(requireFiniteNumber('refVar', refVar) + requireFiniteNumber('bassVar', bassVar)) / boot.fxVelocityShiftDenominator;
  eventBus.emit(EVENTS.BEAT_FX_APPLIED, { beatIndex, sectionIndex, phraseIndex, measureIndex, layer, stereoPan: fxStereoPan, velocityShift: fxVelocityShift });
  isL1 ? playDrums() : playDrums2();
  stutterFX(flipBin ? flipBinT3 : flipBinF3);
  stutterFade(flipBin ? flipBinT3 : flipBinF3);
  rf() < boot.stutterPanJitterChance ? stutterPan(flipBin ? flipBinT3 : flipBinF3) : stutterPan(stutterPanCHs);
  StutterManager.runDuePlans(beatStartTime);

  // -- [stage: intent] -
  if (PROFILE) marks[1] = process.hrtime.bigint();
  const absoluteSeconds = beatStartTime;
  const clIntent = sectionIntentCurves.getIntent();

  // -- [stage: entropy]
  if (PROFILE) marks[2] = process.hrtime.bigint();
  // Blend section-shape arc (30%) with intent entropy target (70%)
  const clArcTarget = entropyRegulator.getArcTarget(timeStream.normalizedProgress('section'));
  entropyRegulator.setTarget(clIntent.entropyTarget, clArcTarget);
  // Regulation aggressiveness scales with deviation from target entropy:
  // large deviation - stronger regulation, near-target - lighter touch.
  const entropyDeviation = m.abs(entropyRegulator.measureEntropy() - clArcTarget);
  entropyRegulator.setRegulationStrength(clamp(0.3 + entropyDeviation * 1.4, 0.2, 0.9));
  const clEntropy = entropyRegulator.getRegulation();

  // -- [stage: phase] --
  if (PROFILE) marks[3] = process.hrtime.bigint();
  const clPhase = phaseAwareCadenceWindow.update(absoluteSeconds, layer);

  // -- [stage: climax] -
  if (PROFILE) marks[4] = process.hrtime.bigint();
  crossLayerClimaxEngine.tick(absoluteSeconds);
  const clClimaxMods = crossLayerClimaxEngine.getModifiers(layer);
  // Stash climax modifiers for playNotesEmitPick (avoids re-calling getModifiers per pick)
  setClimaxMods(clClimaxMods);

  // -- [stage: envelope] --
  if (PROFILE) marks[5] = process.hrtime.bigint();
  crossLayerDynamicEnvelope.tick(absoluteSeconds, layer);
  if (isL1) crossLayerDynamicEnvelope.autoSelectArcType();

  // -- [stage: silhouette]
  if (PROFILE) marks[6] = process.hrtime.bigint();
  crossLayerSilhouette.tick(absoluteSeconds, layer);
  const clSilhouetteCorrections = crossLayerSilhouette.getCorrections();

  // -- [stage: rest]
  if (PROFILE) marks[7] = process.hrtime.bigint();
  const clRestSignals = {
    heatLevel: interactionHeatMap.getDensity(),
    densityTarget: clIntent.densityTarget,
    phaseMode: requireNonEmptyString('rhythmicPhaseLock.getMode()', rhythmicPhaseLock.getMode())
  };
  const clRest = restSynchronizer.evaluateSharedRest(absoluteSeconds, layer, clRestSignals);
  const clComplementRest = restSynchronizer.evaluateComplementaryRest(absoluteSeconds, layer);

  // -- [stage: complement]
  if (PROFILE) marks[8] = process.hrtime.bigint();
  rhythmicComplementEngine.autoSelectMode(absoluteSeconds);

  // -- [stage: tension-cadence] -
  if (PROFILE) marks[9] = process.hrtime.bigint();
  const clTension = requireUnitInterval('conductorState.compositeIntensity', conductorState.getField('compositeIntensity'));
  const clCadence = cadenceAdvisor.shouldCadence();
  V_processBeat.assertPlainObject(clCadence, 'cadenceAdvisor.shouldCadence()');
  V_processBeat.assertBoolean(clCadence.suggest, 'clCadence.suggest');
  const clPhaseSnapshot = { timeInSeconds: absoluteSeconds, phaseDiff: clPhase.phaseDiff, mode: clPhase.mode, confidence: clPhase.confidence };

  // -- [stage: negotiation] --
  if (PROFILE) marks[10] = process.hrtime.bigint();
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

  // -- [stage: probability-adjust] -
  if (PROFILE) marks[11] = process.hrtime.bigint();
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

  // R41 E4: Regime-responsive stutter probability modulation.
  // Coherent regime: tighter stutter (less random), evolving: wilder.
  // Stutter had no direct regime awareness -- regime influenced only
  // indirectly through negotiationEngine. Direct modulation creates
  // more distinct dynamic character per regime.
  const regimeSnap = systemDynamicsProfiler.getSnapshot();
  if (regimeSnap && regimeSnap.regime) {
    // R42 E3: Relax coherent multiplier 0.92->0.96. R41 note count
    // dropped 29% -- coherent stutter suppression too aggressive.
    if (regimeSnap.regime === 'coherent') {
      stutterProb = clamp(stutterProb * 0.96, 0, 1);
    } else if (regimeSnap.regime === 'evolving') {
      stutterProb = clamp(stutterProb * 1.10, 0, 1);
    }
  }

  // -- [stage: emission] --
  if (PROFILE) marks[12] = process.hrtime.bigint();
  playNotes('beat', { playProb, stutterProb });

  // -- [stage: post-beat] -
  if (PROFILE) marks[13] = process.hrtime.bigint();
  if (clRest.shouldRest) restSynchronizer.postRest(absoluteSeconds, layer);

  // Per-beat homeostasis multiplier update. Coupling data is analysed
  // per-measure in the recorder pipeline; the multiplier is smoothed per-beat
  // here for responsive energy governance (~418 ticks/run vs ~78 recorder calls).
  couplingHomeostasis.tick();

  crossLayerBeatRecord({
    layer, absoluteSeconds, clIntent, clPhase, clNegotiation, clBreathing,
    clTension, clCadence, clPhaseSnapshot, clRest, clEntropy, stutterProb, isL1,
    stageTiming: /** @type {Record<string, number> | null} */ (PROFILE ? (() => { marks[14] = process.hrtime.bigint(); const t = {}; for (let i = 0; i < 14; i++) t[STAGE_NAMES[i]] = Number(marks[i + 1] - marks[i]) / 1e6; return t; })() : null)
  });

  return { playProb, stutterProb };
};
