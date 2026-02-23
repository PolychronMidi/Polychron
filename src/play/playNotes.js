// playNotes.js - Unit-level note emission for beat/div/subdiv/subsubdiv
// Implements a focused subset of stage.js note emission logic and delegates
// stutter scheduling to the naked global `noteCascade` when available.

let _playNotesDepsValidated = false;
const V = Validator.create('playNotes');
V.assertObject(EventCatalog, 'EventCatalog');
V.assertObject(EventCatalog.names, 'EventCatalog.names');
const PLAY_EVENTS = EventCatalog.names;

function assertPlayNotesDeps() {
  if (_playNotesDepsValidated) return;
  V.assertObject(motifConfig, 'motifConfig');
  V.requireType(motifConfig.getUnitProfile, 'function', 'motifConfig.getUnitProfile');
  V.assertObject(voiceConfig, 'voiceConfig');
  V.requireType(voiceConfig.getProfile, 'function', 'voiceConfig.getProfile');
  V.assertObject(ConductorConfig, 'ConductorConfig');
  V.requireType(ConductorConfig.getEmissionScaling, 'function', 'ConductorConfig.getEmissionScaling');
  V.requireType(ConductorConfig.getNoiseProfileForSection, 'function', 'ConductorConfig.getNoiseProfileForSection');
  V.assertObject(ComposerRuntimeProfileAdapter, 'ComposerRuntimeProfileAdapter');
  V.requireType(ComposerRuntimeProfileAdapter.getEmissionAdjustments, 'function', 'ComposerRuntimeProfileAdapter.getEmissionAdjustments');
  V.assertObject(TextureBlender, 'TextureBlender');
  V.requireType(TextureBlender.resolve, 'function', 'TextureBlender.resolve');
  V.requireDefined(RhythmManager, 'RhythmManager');
  V.requireType(RhythmManager.swingOffset, 'function', 'RhythmManager.swingOffset');
  V.assertObject(DynamismEngine, 'DynamismEngine');
  V.requireType(DynamismEngine.resolve, 'function', 'DynamismEngine.resolve');
  V.assertObject(TempoFeelEngine, 'TempoFeelEngine');
  V.requireType(TempoFeelEngine.getTickOffset, 'function', 'TempoFeelEngine.getTickOffset');
  V.assertObject(voiceModulator, 'voiceModulator');
  V.requireType(voiceModulator.distribute, 'function', 'voiceModulator.distribute');
  _playNotesDepsValidated = true;
}


/**
 * @param {'beat'|'div'|'subdiv'|'subsubdiv'} unit
 * @param {Object} opts
 */
playNotes = function(unit = 'subdiv', opts = {}) {
  assertPlayNotesDeps();
  V.assertPlainObject(opts, 'opts');
  const {
    playProb = 0,
    stutterProb = 0
  } = opts;

  V.requireDefined(LM, 'LayerManager');
  V.requireType(LM.getComposerFor, 'function', 'LayerManager.getComposerFor');
  V.assertObject(LM.layers, 'LayerManager.layers');
  V.assertNonEmptyString(LM.activeLayer, 'LayerManager.activeLayer');
  const layer = LM.layers[LM.activeLayer];
  V.assertObject(layer, `LayerManager.layers.${LM.activeLayer}`);
  const activeComposer = LM.getComposerFor(LM.activeLayer);

  const runtimeProfile = (activeComposer && V.optionalType(activeComposer.runtimeProfile, 'object'))
    ? activeComposer.runtimeProfile
    : null;

  if (!runtimeProfile) {
    throw new Error(`${unit}.playNotes: active composer runtimeProfile is required`);
  }
  const emissionAdjustments = ComposerRuntimeProfileAdapter.getEmissionAdjustments(runtimeProfile);

  V.assertObject(emissionAdjustments, 'emissionAdjustments');

  const emitNotesEmitted = (actual, intended, reason = 'unknown') => {
    const actualCount = V.requireFinite(actual, 'notesEmitted.actual');
    const intendedCountLocal = V.requireFinite(intended, 'notesEmitted.intended');
    const playProbLocal = V.requireFinite(playProb, 'notesEmitted.playProb');
    const stutterProbLocal = V.requireFinite(stutterProb, 'notesEmitted.stutterProb');
    const tickValue = V.requireFinite(unitStart, 'notesEmitted.tick');
    EventBus.emit(PLAY_EVENTS.NOTES_EMITTED, {
      unit,
      layer: LM.activeLayer,
      actual: actualCount,
      intended: intendedCountLocal,
      playProb: playProbLocal,
      stutterProb: stutterProbLocal,
      reason,
      tick: tickValue
    });
  };

  // Conductor profile drives emission noise and voice velocity blend
  const emissionScaling = ConductorConfig.getEmissionScaling();
  V.assertObject(emissionScaling, 'ConductorConfig.getEmissionScaling()');
  const phaseNoiseProfile = ConductorConfig.getNoiseProfileForSection();
  V.assertNonEmptyString(phaseNoiseProfile, 'ConductorConfig.getNoiseProfileForSection()');
  const emissionCfg = Object.assign({}, emissionScaling, { noiseProfile: phaseNoiseProfile });

  const { on, sustain, binVel, noiseInfluence, currentTime, voiceIdSeed } = playNotesComputeUnit(unit, emissionAdjustments, emissionCfg, layer);

  let scheduled = 0;
  let intendedCount = 1;
  crossModulateRhythms();

  // DynamismEngine is the single probability authority. When probs arrive from
  // GlobalConductor they are already DynamismEngine-resolved; pass them through
  // without re-modulating to prevent double-application of the same signals.
  // Only invoke DynamismEngine directly for sub-beat units (div/subdiv/subsubdiv)
  // that need per-unit pulse refinement.
  const needsPerUnitResolve = (unit !== 'beat');
  const resolved = (needsPerUnitResolve)
    ? DynamismEngine.resolve(unit, { playProb, stutterProb })
    : { playProb, stutterProb, composite: clamp(ConductorState.getField('compositeIntensity'), 0, 1) };
  const resolvedPlayProb = V.requireFinite(Number(resolved.playProb), 'resolved.playProb');
  const resolvedStutterProb = V.requireFinite(Number(resolved.stutterProb), 'resolved.stutterProb');

  // ── TextureBlender: per-unit contrast-blend mode ──────────────────
  // Decides whether this unit emits normally, fires a percussive chord
  // stab, or injects a rapid scalar flurry.  Oscillation-driven so the
  // texture switching never settles into a predictable pattern.
  const textureComposite = V.requireFinite(Number(resolved.composite), 'resolved.composite');
  const textureMode = TextureBlender.resolve(unit, textureComposite);

  // ── Emit texture-contrast event for drum coupling (#5) ─────────
  if (textureMode.mode !== 'single') {
    EventBus.emit(PLAY_EVENTS.TEXTURE_CONTRAST, { mode: textureMode.mode, unit, composite: textureComposite });
  }

  // Per-layer + per-unit voice budget (prevents first-invocation dominance)
  V.requireDefined(LM, 'LM');
  V.assertObject(LM.layers, 'LM.layers');
  V.assertNonEmptyString(LM.activeLayer, 'LM.activeLayer');
  const layerName = LM.activeLayer;
  const unitStartValue = V.requireFinite(unitStart, 'unitStart');
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
    emitNotesEmitted(0, intendedCount, 'probability-gate');
    return trackRhythm(unit, layer, false);
  }

  // Delegate motif selection and transformation to playMotifs
  const picks = playMotifs(unit, layer);
  if (!Array.isArray(picks)) {
    throw new Error(`${unit}.playNotes: playMotifs must return an array`);
  }
  intendedCount = picks.length;

  // Apply voiceModulator to get per-pick velocity distribution
  // This gives each voice a slightly different velocity for natural ensemble feel
  if (Array.isArray(picks) && picks.length > 0) {
    const distributed = voiceModulator.distribute(picks.map(p => p.note), { baseVelocity: velocity, textureMode: textureMode.mode });
    for (let di = 0; di < m.min(distributed.length, picks.length); di++) {
      if (Number.isFinite(distributed[di].velocity)) picks[di]._distributedVelocity = distributed[di].velocity;
    }
  }

  // Enforce per-layer, per-unit remaining voice slots — trim picks if necessary
  if (Array.isArray(picks) && picks.length > 0) {
    const available = m.max(0, V.optionalFinite(Number(remainingVoiceSlotsByLayer[layerName]), V.requireFinite(Number(remainingVoiceSlots), 'remainingVoiceSlots')));
    const allowed = m.max(0, m.min(picks.length, available));
    if (allowed <= 0) {
      // no budget available for this layer/unit — skip emission
      emitNotesEmitted(0, intendedCount, 'voice-budget');
      return trackRhythm(unit, layer, false);
    }
    if (allowed < picks.length) picks.length = allowed; // truncate in-place

    // Decrement per-layer budget and keep legacy global in sync
    remainingVoiceSlotsByLayer[layerName] = m.max(0, available - picks.length);
    remainingVoiceSlots = remainingVoiceSlotsByLayer[layerName];
  }

  try {
    V.requireType(playNotesEmitPick, 'function', `${unit}.playNotes: playNotesEmitPick helper`);

    for (let pi = 0; pi < picks.length; pi++) {
      scheduled += playNotesEmitPick({
        unit,
        pick: picks[pi],
        pickIndex: pi,
        resolvedStutterProb,
        on,
        tpUnit,
        sustain,
        textureMode,
        velocity,
        binVel,
        emissionCfg,
        noiseInfluence,
        currentTime,
        voiceIdSeed
      });
    }
    emitNotesEmitted(scheduled, intendedCount, 'scheduled');
    trackRhythm(unit, layer, true);
  } catch (e) {
    emitNotesEmitted(0, intendedCount, 'emit-error');
    trackRhythm(unit, layer, false);
    throw new Error(`${unit}.playNotes: non-fatal error while playing notes: ${e && e.stack ? e.stack : String(e)}`);
  }

  return scheduled;
};
