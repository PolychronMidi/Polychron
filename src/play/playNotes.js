// playNotes.js - Unit-level note emission for beat/div/subdiv/subsubdiv
// Implements a focused subset of stage.js note emission logic and delegates
// stutter scheduling to the naked global `noteCascade` when available.

let playNotesPlayNotesDepsValidated = false;
let playNotesMeasureContextValidated = -1; // beatCount at last validation
const V = validator.create('playNotes');
const PLAY_NOTES_PROFILE = process.argv.includes('--trace');
V.assertObject(eventCatalog, 'eventCatalog');
V.assertObject(eventCatalog.names, 'eventCatalog.names');
const PLAY_EVENTS = eventCatalog.names;

function playNotesRecordProfileMetric(name, startedAt) {
  if (!PLAY_NOTES_PROFILE) return;
  traceDrain.recordRuntimeMetric(name, Number(process.hrtime.bigint() - startedAt) / 1e6);
}

function assertPlayNotesDeps() {
  if (playNotesPlayNotesDepsValidated) return;
  V.assertManagerShape(motifConfig, 'motifConfig', ['getUnitProfile']);
  V.assertManagerShape(voiceConfig, 'voiceConfig', ['getProfile']);
  V.assertManagerShape(conductorConfig, 'conductorConfig', ['getEmissionScaling', 'getNoiseProfileForSection']);
  V.assertManagerShape(composerRuntimeProfileAdapter, 'composerRuntimeProfileAdapter', ['getEmissionAdjustments']);
  V.assertManagerShape(textureBlender, 'textureBlender', ['resolve']);
  V.assertManagerShape(RhythmManager, 'RhythmManager', ['swingOffset']);
  V.assertManagerShape(dynamismEngine, 'dynamismEngine', ['resolve']);
  V.assertManagerShape(tempoFeelEngine, 'tempoFeelEngine', ['getTimeOffset']);
  V.assertManagerShape(voiceModulator, 'voiceModulator', ['distribute']);
  playNotesPlayNotesDepsValidated = true;
}


/**
 * @param {'beat'|'div'|'subdiv'|'subsubdiv'} unit
 * @param {Object} opts
 */
playNotes = function(unit = 'subdiv', opts = {}) {
  const playNotesStartedAt = PLAY_NOTES_PROFILE ? process.hrtime.bigint() : 0n;
  assertPlayNotesDeps();
  V.assertPlainObject(opts, 'opts');
  const {
    playProb = 0,
    stutterProb = 0
  } = opts;

  // Validate LM shape once per beat (globals don't change within a beat)
  if (playNotesMeasureContextValidated !== beatCount) {
    V.requireDefined(LM, 'LayerManager');
    V.assertManagerShape(LM, 'LayerManager', ['getComposerFor']);
    V.assertObject(LM.layers, 'LayerManager.layers');
    playNotesMeasureContextValidated = beatCount;
  }
  V.assertNonEmptyString(LM.activeLayer, 'LayerManager.activeLayer');
  const activeLayer = /** @type {string} */ (LM.activeLayer);
  const layer = LM.layers[activeLayer];
  V.assertObject(layer, `LayerManager.layers.${activeLayer}`);
  const activeComposer = LM.getComposerFor(activeLayer);

  const runtimeProfile = (activeComposer && V.optionalType(activeComposer.runtimeProfile, 'object'))
    ? activeComposer.runtimeProfile
    : null;

  if (!runtimeProfile) {
    throw new Error(`${unit}.playNotes: active composer runtimeProfile is required`);
  }
  const emissionAdjustments = composerRuntimeProfileAdapter.getEmissionAdjustments(runtimeProfile);

  V.assertObject(emissionAdjustments, 'emissionAdjustments');

  const emitNotesEmitted = (actual, intended, reason = 'unknown') => {
    const actualCount = V.requireFinite(actual, 'notesEmitted.actual');
    const intendedCountLocal = V.requireFinite(intended, 'notesEmitted.intended');
    const playProbLocal = V.requireFinite(playProb, 'notesEmitted.playProb');
    const stutterProbLocal = V.requireFinite(stutterProb, 'notesEmitted.stutterProb');
    eventBus.emit(PLAY_EVENTS.NOTES_EMITTED, {
      unit,
      layer: activeLayer,
      actual: actualCount,
      intended: intendedCountLocal,
      playProb: playProbLocal,
      stutterProb: stutterProbLocal,
      reason
    });
  };

  // Conductor profile drives emission noise and voice velocity blend
  const emissionScaling = conductorConfig.getEmissionScaling();
  V.assertObject(emissionScaling, 'conductorConfig.getEmissionScaling()');
  const phaseNoiseProfile = conductorConfig.getNoiseProfileForSection();
  V.assertNonEmptyString(phaseNoiseProfile, 'conductorConfig.getNoiseProfileForSection()');
  const emissionCfg = Object.assign({}, emissionScaling, { noiseProfile: phaseNoiseProfile });

  const computeStartedAt = PLAY_NOTES_PROFILE ? process.hrtime.bigint() : 0n;
  const { on, sustain, binVel, noiseInfluence, currentTime, voiceIdSeed } = playNotesComputeUnit(unit, emissionAdjustments, emissionCfg, layer);
  playNotesRecordProfileMetric(`playNotes.compute.${unit}`, computeStartedAt);

  let scheduled = 0;
  let intendedCount = 1;
  crossModulateRhythms();

  // dynamismEngine is the single probability authority. When probs arrive from
  // globalConductor they are already dynamismEngine-resolved; pass them through
  // without re-modulating to prevent double-application of the same signals.
  // Only invoke dynamismEngine directly for sub-beat units (div/subdiv/subsubdiv)
  // that need per-unit pulse refinement.
  const needsPerUnitResolve = (unit !== 'beat');
  const resolveStartedAt = PLAY_NOTES_PROFILE ? process.hrtime.bigint() : 0n;
  const resolved = (needsPerUnitResolve)
    ? dynamismEngine.resolve(unit, { playProb, stutterProb })
    : { playProb, stutterProb, composite: clamp(conductorState.getField('compositeIntensity'), 0, 1) };
  playNotesRecordProfileMetric(`playNotes.resolve.${unit}`, resolveStartedAt);
  const resolvedPlayProb = V.requireFinite(Number(resolved.playProb), 'resolved.playProb');
  const resolvedStutterProb = V.requireFinite(Number(resolved.stutterProb), 'resolved.stutterProb');

  // -- textureBlender: per-unit contrast-blend mode
  // Decides whether this unit emits normally, fires a percussive chord
  // stab, or injects a rapid scalar flurry.  Oscillation-driven so the
  // texture switching never settles into a predictable pattern.
  const textureComposite = V.requireFinite(Number(resolved.composite), 'resolved.composite');
  const textureStartedAt = PLAY_NOTES_PROFILE ? process.hrtime.bigint() : 0n;
  const textureMode = textureBlender.resolve(unit, textureComposite);
  playNotesRecordProfileMetric(`playNotes.texture.${unit}`, textureStartedAt);

  // -- Emit texture-contrast event for drum coupling (#5)
  if (textureMode.mode !== 'single') {
    eventBus.emit(PLAY_EVENTS.TEXTURE_CONTRAST, { mode: textureMode.mode, unit, composite: textureComposite });
  }

  // Per-layer + per-unit voice budget (prevents first-invocation dominance)
  const layerName = /** @type {string} */ (LM.activeLayer);
  const unitStartValue = V.requireFinite(unitStartTime, 'unitStartTime');
  const unitBudgetKey = `${layerName}:${unit}:${unitStartValue}`;

  // Ensure per-layer budget maps exist (init.js defines these globals)
  V.assertObject(remainingVoiceSlotsByLayer, 'remainingVoiceSlotsByLayer');
  V.assertObject(lastVoiceBudgetKeyByLayer, 'lastVoiceBudgetKeyByLayer');

  if (lastVoiceBudgetKeyByLayer[layerName] !== unitBudgetKey) {
    const unitCfg = (unit === 'div') ? DIV_VOICES
      : (unit === 'subdiv') ? SUBDIV_VOICES
      : (unit === 'subsubdiv') ? SUBSUBDIV_VOICES
      : BEAT_VOICES;
    V.assertObject(unitCfg, `${unit} voice unit configuration`);
    V.requireFinite(Number(unitCfg.max), 'unitCfg.max');
    remainingVoiceSlotsByLayer[layerName] = Number(unitCfg.max);
    lastVoiceBudgetKeyByLayer[layerName] = unitBudgetKey;
  }

  // Keep legacy globals in sync for backward compatibility
  remainingVoiceSlots = remainingVoiceSlotsByLayer[layerName];
  const layerBudgetKey = lastVoiceBudgetKeyByLayer[layerName];
  if (layerBudgetKey === undefined) {
    throw new Error(`${unit}.playNotes: lastVoiceBudgetKeyByLayer[${layerName}] is not initialized`);
  }
  lastVoiceBudgetKey = `${layerName}:${String(layerBudgetKey)}`;

  // Gate play invocation with playProb and crossModulation
  if (V.optionalFinite(resolvedPlayProb) !== undefined && (rf() > resolvedPlayProb * rf(1,2)) && (crossModulation < rv(rf(1.8,2.2), [-.2, -.3], .05))) {
    if (unit === 'beat' || unit === 'div') emitNotesEmitted(0, intendedCount, 'probability-gate');
    const gatedResult = trackRhythm(unit, layer, false);
    if (PLAY_NOTES_PROFILE) traceDrain.recordRuntimeMetric(`playNotes.${unit}`, Number(process.hrtime.bigint() - playNotesStartedAt) / 1e6);
    return gatedResult;
  }

  // Delegate motif selection and transformation to playMotifs
  const motifStartedAt = PLAY_NOTES_PROFILE ? process.hrtime.bigint() : 0n;
  const picks = playMotifs(unit, layer);
  playNotesRecordProfileMetric(`playNotes.motifs.${unit}`, motifStartedAt);
  V.assertArray(picks, 'picks');
  intendedCount = picks.length;

  // Apply voiceModulator to get per-pick velocity distribution
  // This gives each voice a slightly different velocity for natural ensemble feel
  if (Array.isArray(picks) && picks.length > 0) {
    const velocityDistStartedAt = PLAY_NOTES_PROFILE ? process.hrtime.bigint() : 0n;
    const pickNotes = new Array(picks.length);
    for (let pickIndex = 0; pickIndex < picks.length; pickIndex++) {
      pickNotes[pickIndex] = picks[pickIndex].note;
    }
    const distributed = voiceModulator.distribute(pickNotes, { baseVelocity: velocity, textureMode: textureMode.mode });
    for (let di = 0; di < m.min(distributed.length, picks.length); di++) {
      if (Number.isFinite(distributed[di].velocity)) picks[di].playNotesDistributedVelocity = distributed[di].velocity;
    }
    playNotesRecordProfileMetric(`playNotes.voiceDistribute.${unit}`, velocityDistStartedAt);
  }

  // Enforce per-layer, per-unit remaining voice slots - trim picks if necessary
  if (Array.isArray(picks) && picks.length > 0) {
    const available = m.max(0, V.optionalFinite(Number(remainingVoiceSlotsByLayer[layerName]), V.requireFinite(Number(remainingVoiceSlots), 'remainingVoiceSlots')));
    const allowed = m.max(0, m.min(picks.length, available));
    if (allowed <= 0) {
      // no budget available for this layer/unit - skip emission
      if (unit === 'beat' || unit === 'div') emitNotesEmitted(0, intendedCount, 'voice-budget');
      const budgetResult = trackRhythm(unit, layer, false);
      if (PLAY_NOTES_PROFILE) traceDrain.recordRuntimeMetric(`playNotes.${unit}`, Number(process.hrtime.bigint() - playNotesStartedAt) / 1e6);
      return budgetResult;
    }
    if (allowed < picks.length) picks.length = allowed; // truncate in-place

    // Decrement per-layer budget and keep legacy global in sync
    remainingVoiceSlotsByLayer[layerName] = m.max(0, available - picks.length);
    remainingVoiceSlots = remainingVoiceSlotsByLayer[layerName];
  }

  try {
    V.requireType(playNotesEmitPick, 'function', `${unit}.playNotes: playNotesEmitPick helper`);

    const emitStartedAt = PLAY_NOTES_PROFILE ? process.hrtime.bigint() : 0n;
    let picksEmitted = 0;
    for (let pi = 0; pi < picks.length; pi++) {
      const events = playNotesEmitPick({
        unit,
        pick: picks[pi],
        pickIndex: pi,
        resolvedStutterProb,
        on,
        spUnit,
        sustain,
        textureMode,
        velocity,
        binVel,
        emissionCfg,
        noiseInfluence,
        currentTime,
        voiceIdSeed
      });
      scheduled += events;
      if (events > 0) picksEmitted++;
    }
    playNotesRecordProfileMetric(`playNotes.emitLoop.${unit}`, emitStartedAt);
    if (unit === 'beat' || unit === 'div') emitNotesEmitted(picksEmitted, intendedCount, 'scheduled');
    trackRhythm(unit, layer, true);
  } catch (e) {
    if (unit === 'beat' || unit === 'div') emitNotesEmitted(0, intendedCount, 'emit-error');
    trackRhythm(unit, layer, false);
    throw new Error(`${unit}.playNotes: error while playing notes: ${e && e.stack ? e.stack : String(e)}`);
  }

  if (PLAY_NOTES_PROFILE) traceDrain.recordRuntimeMetric(`playNotes.${unit}`, Number(process.hrtime.bigint() - playNotesStartedAt) / 1e6);
  return scheduled;
};
