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
  V.assertObject(RhythmManager, 'RhythmManager');
  V.requireType(RhythmManager.swingOffset, 'function', 'RhythmManager.swingOffset');
  V.assertObject(DynamismEngine, 'DynamismEngine');
  V.requireType(DynamismEngine.resolve, 'function', 'DynamismEngine.resolve');
  V.assertObject(TempoFeelEngine, 'TempoFeelEngine');
  V.requireType(TempoFeelEngine.getTickOffset, 'function', 'TempoFeelEngine.getTickOffset');
  V.assertObject(voiceModulator, 'voiceModulator');
  V.requireType(voiceModulator.distribute, 'function', 'voiceModulator.distribute');
  _playNotesDepsValidated = true;
}

playNotes = function(unit = 'subdiv', opts = {}) {
  assertPlayNotesDeps();
  V.assertPlainObject(opts, 'opts');
  const {
    playProb = 0,
    stutterProb = 0
  } = opts;

  V.assertObject(LM, 'LayerManager');
  V.requireType(LM.getComposerFor, 'function', 'LayerManager.getComposerFor');
  V.assertNonEmptyString(LM.activeLayer, 'LayerManager.activeLayer');
  const layer = LM.layers[LM.activeLayer];
  V.assertObject(layer, `LayerManager.layers.${LM.activeLayer}`);
  const activeComposer = LM.getComposerFor(LM.activeLayer);

  const runtimeProfile = (activeComposer && activeComposer.runtimeProfile && typeof activeComposer.runtimeProfile === 'object')
    ? activeComposer.runtimeProfile
    : null;

  if (!runtimeProfile) {
    throw new Error(`${unit}.playNotes: active composer runtimeProfile is required`);
  }
  const emissionAdjustments = ComposerRuntimeProfileAdapter.getEmissionAdjustments(runtimeProfile);

  V.assertObject(emissionAdjustments, 'emissionAdjustments');

  const baseVelocitySeed = V.requireFinite(emissionAdjustments.baseVelocity, 'emissionAdjustments.baseVelocity');
  const combinedVelocityScale = V.requireFinite(emissionAdjustments.velocityScale, 'emissionAdjustments.velocityScale');

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

  const motifTimingOffsetUnits = V.requireFinite(emissionAdjustments.timingOffsetUnits, 'emissionAdjustments.timingOffsetUnits');
  const rhythmSwingAmount = V.requireFinite(emissionAdjustments.swingAmount, 'emissionAdjustments.swingAmount');

  if (!Number.isFinite(Number(tpUnit))) {
    throw new Error(`${unit}.playNotes: tpUnit must be a finite number`);
  }
  if (!Number.isFinite(Number(beatStart))) {
    throw new Error(`${unit}.playNotes: beatStart must be a finite number`);
  }
  const swingTicks = Number(RhythmManager.swingOffset(V.requireFinite(beatIndex, 'beatIndex'), rhythmSwingAmount));
  if (!Number.isFinite(swingTicks)) {
    throw new Error(`${unit}.playNotes: RhythmManager.swingOffset must return a finite number`);
  }
  const timingOffsetTicks = (motifTimingOffsetUnits * Number(tpUnit)) + swingTicks;

  // Apply micro-tempo variation from TempoFeelEngine
  const tempoFeelOffset = TempoFeelEngine.getTickOffset();
  if (!Number.isFinite(Number(tempoFeelOffset))) {
    throw new Error(`${unit}.playNotes: TempoFeelEngine.getTickOffset must return a finite number`);
  }

  // Compute on and sustain
  const on = unitStart + timingOffsetTicks + tempoFeelOffset + (tpUnit * rv(rf(.2), [-.1, .07], .3));
  const shortSustain = rv(rf(m.max(tpUnit * .5, tpUnit / unitsPerParent), (tpUnit * (.3 + rf() * .7))), [.1, .2], .1, [-.05, -.1]);
  const longSustain = rv(rf(tpUnit * .8, (tpParent * (.3 + rf() * .7))), [.1, .3], .1, [-.05, -0.1]);
  const useShort = subdivsPerMinute > ri(400, 650);
  const sustain = (useShort ? shortSustain : longSustain) * rv(rf(.8, 1.3));
  velocity = rl(baseVelocitySeed,-3,3,95,105);
  if (!Number.isFinite(combinedVelocityScale) || combinedVelocityScale <= 0) {
    throw new Error(`${unit}.playNotes: combined profile velocity scale must be a positive finite number`);
  }
  velocity = m.max(1, m.min(127, m.round(velocity * combinedVelocityScale)));

  // Apply unit-level velocity scaling from motifConfig hierarchy
  // (beat=1.0, div=0.9, subdiv=0.85, subsubdiv=0.8 — finer units play softer)
  const unitProfile = motifConfig.getUnitProfile(unit);
  if (unitProfile && Number.isFinite(unitProfile.velocityScale)) {
    velocity = m.max(1, m.min(127, m.round(velocity * unitProfile.velocityScale)));
  }

  // Apply voiceConfig profile for additional velocity shaping
  const vcProfile = voiceConfig.getProfile('default');
  if (vcProfile && Number.isFinite(vcProfile.baseVelocity)) {
    velocity = m.max(1, m.min(127, m.round(velocity * (1 - emissionCfg.voiceConfigBlend) + vcProfile.baseVelocity * emissionCfg.voiceConfigBlend)));
  }

  const binVel = rv(velocity * rf(.4, .9));

  let scheduled = 0;
  let intendedCount = 1;
  crossModulateRhythms();

  // Apply subtle noise modulation to base velocity for organic variation
  V.requireType(getNoiseProfile, 'function', 'getNoiseProfile');
  const noiseProfile = getNoiseProfile(emissionCfg.noiseProfile);
  V.assertObject(noiseProfile, `getNoiseProfile(${emissionCfg.noiseProfile})`);
  const influenceX = Number(noiseProfile.influenceX);
  const influenceY = Number(noiseProfile.influenceY);
  if (!Number.isFinite(influenceX) || !Number.isFinite(influenceY)) {
    throw new Error(`${unit}.playNotes: subtle noise profile influence must be finite`);
  }
  const noiseInfluence = clamp((influenceX + influenceY) / 2, 0, 1);
  const currentTime = beatStart + tpUnit * 0.5; // Approximate time within the unit
  const layerIdValue = layer && Object.prototype.hasOwnProperty.call(layer, 'id') ? layer.id : null;
  let layerIdSeed;
  if (typeof layerIdValue === 'number' && Number.isFinite(layerIdValue)) {
    layerIdSeed = layerIdValue;
  } else if (typeof layerIdValue === 'string' && layerIdValue.length > 0) {
    layerIdSeed = Array.from(layerIdValue).reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  } else if (typeof LM.activeLayer === 'string' && LM.activeLayer.length > 0) {
    layerIdSeed = Array.from(LM.activeLayer).reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  } else {
    throw new Error(`${unit}.playNotes: active layer id must be a finite number or non-empty string`);
  }
  const voiceIdSeed = m.round(Number(beatStart) * 73 + layerIdSeed * 43 + V.requireFinite(measureCount, 'measureCount')); // Deterministic voice ID from context

  // DynamismEngine is the single probability authority. When probs arrive from
  // GlobalConductor they are already DynamismEngine-resolved; pass them through
  // without re-modulating to prevent double-application of the same signals.
  // Only invoke DynamismEngine directly for sub-beat units (div/subdiv/subsubdiv)
  // that need per-unit pulse refinement.
  const needsPerUnitResolve = (unit !== 'beat');
  const resolved = (needsPerUnitResolve)
    ? DynamismEngine.resolve(unit, { playProb, stutterProb })
    : { playProb, stutterProb, composite: 0 };
  const resolvedPlayProb = Number(resolved.playProb);
  const resolvedStutterProb = Number(resolved.stutterProb);
  if (!Number.isFinite(resolvedPlayProb) || !Number.isFinite(resolvedStutterProb)) {
    throw new Error(`${unit}.playNotes: resolved probabilities must be finite`);
  }

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
  V.assertObject(LM, 'LM');
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
    if (!unitCfg || !Number.isFinite(Number(unitCfg.max))) {
      throw new Error(`${unit}.playNotes: invalid voice unit configuration`);
    }
    remainingVoiceSlotsByLayer[layerName] = Number(unitCfg.max);
    lastVoiceBudgetKeyByLayer[layerName] = unitBudgetKey;
  }

  // Keep legacy globals in sync for backward compatibility
  remainingVoiceSlots = remainingVoiceSlotsByLayer[layerName];
  const layerBudgetKey = lastVoiceBudgetKeyByLayer[layerName];
  if (typeof layerBudgetKey === 'undefined') {
    throw new Error(`${unit}.playNotes: lastVoiceBudgetKeyByLayer[${layerName}] is not initialized`);
  }
  lastVoiceBudgetKey = `${layerName}:${String(layerBudgetKey)}`;

  // Gate play invocation with playProb and crossModulation
  if (typeof resolvedPlayProb === 'number' && (rf() > resolvedPlayProb * rf(1,2)) && (crossModulation < rv(rf(1.8,2.2), [-.2, -.3], .05))) {
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
    const available = Number.isFinite(Number(remainingVoiceSlotsByLayer[layerName]))
      ? m.max(0, Number(remainingVoiceSlotsByLayer[layerName]))
      : Number(remainingVoiceSlots);
    if (!Number.isFinite(available)) {
      throw new Error(`${unit}.playNotes: invalid available voice budget for layer ${layerName}`);
    }
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
