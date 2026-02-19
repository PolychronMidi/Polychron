// playNotes.js - Unit-level note emission for beat/div/subdiv/subsubdiv
// Implements a focused subset of stage.js note emission logic and delegates
// stutter scheduling to the naked global `noteCascade` when available.

let _playNotesDepsValidated = false;
const PLAY_EVENTS = (typeof EventCatalog !== 'undefined' && EventCatalog && EventCatalog.names)
  ? EventCatalog.names
  : {
      TEXTURE_CONTRAST: 'texture-contrast',
      NOTES_EMITTED: 'notes-emitted'
    };

function assertPlayNotesDeps() {
  if (_playNotesDepsValidated) return;
  if (typeof motifConfig === 'undefined' || !motifConfig || typeof motifConfig.getUnitProfile !== 'function') {
    throw new Error('playNotes: motifConfig.getUnitProfile is required');
  }
  if (typeof voiceConfig === 'undefined' || !voiceConfig || typeof voiceConfig.getProfile !== 'function') {
    throw new Error('playNotes: voiceConfig.getProfile is required');
  }
  if (typeof EventBus === 'undefined' || !EventBus || typeof EventBus.emit !== 'function') {
    throw new Error('playNotes: EventBus.emit is required');
  }
  if (typeof ConductorConfig === 'undefined' || !ConductorConfig || typeof ConductorConfig.getEmissionScaling !== 'function') {
    throw new Error('playNotes: ConductorConfig.getEmissionScaling is required');
  }
  _playNotesDepsValidated = true;
}

playNotes = function(unit = 'subdiv', opts = {}) {
  assertPlayNotesDeps();
  const {
    playProb = 0,
    stutterProb = 0
  } = opts;

  if (!LM || typeof LM.getComposerFor !== 'function') {
    throw new Error(`${unit}.playNotes: LayerManager.getComposerFor not available`);
  }
  if (typeof LM.activeLayer !== 'string' || LM.activeLayer.length === 0) {
    throw new Error(`${unit}.playNotes: LayerManager.activeLayer is not set`);
  }
  const layer = LM.layers[LM.activeLayer];
  if (!layer || typeof layer !== 'object') {
    throw new Error(`${unit}.playNotes: active layer "${LM.activeLayer}" not found`);
  }
  const activeComposer = LM.getComposerFor(LM.activeLayer);

  const runtimeProfile = (activeComposer && activeComposer.runtimeProfile && typeof activeComposer.runtimeProfile === 'object')
    ? activeComposer.runtimeProfile
    : null;

  const emissionAdjustments = (runtimeProfile && typeof ComposerRuntimeProfileAdapter !== 'undefined' && ComposerRuntimeProfileAdapter && typeof ComposerRuntimeProfileAdapter.getEmissionAdjustments === 'function')
    ? ComposerRuntimeProfileAdapter.getEmissionAdjustments(runtimeProfile)
    : {
      baseVelocity: (activeComposer && Number.isFinite(Number(activeComposer.baseVelocity))) ? Number(activeComposer.baseVelocity) : null,
      velocityScale: (activeComposer && Number.isFinite(Number(activeComposer.profileVelocityScale))) ? Number(activeComposer.profileVelocityScale) : 1,
      timingOffsetUnits: (activeComposer && Number.isFinite(Number(activeComposer.profileTimingOffsetUnits))) ? Number(activeComposer.profileTimingOffsetUnits) : 0,
      swingAmount: (activeComposer && Number.isFinite(Number(activeComposer.profileSwingAmount))) ? Number(activeComposer.profileSwingAmount) : 0
    };

  const baseVelocitySeed = (Number.isFinite(Number(emissionAdjustments.baseVelocity)))
    ? Number(emissionAdjustments.baseVelocity)
    : velocity;

  const combinedVelocityScale = Number.isFinite(Number(emissionAdjustments.velocityScale))
    ? Number(emissionAdjustments.velocityScale)
    : 1;

  const emitNotesEmitted = (actual, intended, reason = 'unknown') => {
    EventBus.emit(PLAY_EVENTS.NOTES_EMITTED, {
      unit,
      layer: LM.activeLayer,
      actual: Number.isFinite(Number(actual)) ? Number(actual) : 0,
      intended: Number.isFinite(Number(intended)) ? Number(intended) : 0,
      playProb: Number.isFinite(Number(playProb)) ? Number(playProb) : 0,
      stutterProb: Number.isFinite(Number(stutterProb)) ? Number(stutterProb) : 0,
      reason,
      tick: Number.isFinite(Number(unitStart)) ? Number(unitStart) : 0
    });
  };

  // Conductor profile drives emission noise and voice velocity blend
  const emissionScaling = ConductorConfig.getEmissionScaling();
  const phaseNoiseProfile = (typeof ConductorConfig.getNoiseProfileForSection === 'function')
    ? ConductorConfig.getNoiseProfileForSection()
    : null;
  const emissionCfg = (emissionScaling && typeof emissionScaling === 'object')
    ? Object.assign({}, emissionScaling, {
        noiseProfile: (typeof phaseNoiseProfile === 'string' && phaseNoiseProfile.length > 0)
          ? phaseNoiseProfile
          : emissionScaling.noiseProfile
      })
    : { noiseProfile: 'subtle', sourceNoiseInfluence: 0.12, reflectionNoiseInfluence: 0.10, bassNoiseInfluence: 0.08, voiceConfigBlend: 0.3 };

  const motifTimingOffsetUnits = Number.isFinite(Number(emissionAdjustments.timingOffsetUnits))
    ? Number(emissionAdjustments.timingOffsetUnits)
    : 0;
  const rhythmSwingAmount = Number.isFinite(Number(emissionAdjustments.swingAmount))
    ? Number(emissionAdjustments.swingAmount)
    : 0;

  if (!Number.isFinite(Number(tpUnit))) {
    throw new Error(`${unit}.playNotes: tpUnit must be a finite number`);
  }
  if (!Number.isFinite(Number(beatStart))) {
    throw new Error(`${unit}.playNotes: beatStart must be a finite number`);
  }
  const swingTicks = (Number.isFinite(Number(beatIndex)) && rhythmSwingAmount !== 0 && typeof RhythmManager !== 'undefined' && RhythmManager && typeof RhythmManager.swingOffset === 'function')
    ? Number(RhythmManager.swingOffset(Number(beatIndex), rhythmSwingAmount))
    : 0;
  const timingOffsetTicks = (motifTimingOffsetUnits * Number(tpUnit)) + swingTicks;

  // Apply micro-tempo variation from TempoFeelEngine
  const tempoFeelOffset = (typeof TempoFeelEngine !== 'undefined' && TempoFeelEngine && typeof TempoFeelEngine.getTickOffset === 'function')
    ? TempoFeelEngine.getTickOffset()
    : 0;

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
  if (typeof getNoiseProfile !== 'function') {
    throw new Error(`${unit}.playNotes: getNoiseProfile not available`);
  }
  const noiseProfile = getNoiseProfile(emissionCfg.noiseProfile);
  if (!noiseProfile || typeof noiseProfile !== 'object') {
    throw new Error(`${unit}.playNotes: invalid noise profile returned for "${emissionCfg.noiseProfile}"`);
  }
  const influenceX = Number(noiseProfile.influenceX);
  const influenceY = Number(noiseProfile.influenceY);
  if (!Number.isFinite(influenceX) || !Number.isFinite(influenceY)) {
    throw new Error(`${unit}.playNotes: subtle noise profile influence must be finite`);
  }
  const noiseInfluence = clamp((influenceX + influenceY) / 2, 0, 1);
  const currentTime = beatStart + tpUnit * 0.5; // Approximate time within the unit
  const layerIdSeed = Number.isFinite(Number(layer && layer.id))
    ? Number(layer.id)
    : (typeof LM.activeLayer === 'string' ? Array.from(LM.activeLayer).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) : 0);
  const voiceIdSeed = m.round(Number(beatStart) * 73 + layerIdSeed * 43 + (Number.isFinite(Number(measureCount)) ? Number(measureCount) : 0)); // Deterministic voice ID from context

  // DynamismEngine is the single probability authority. When probs arrive from
  // GlobalConductor they are already DynamismEngine-resolved; pass them through
  // without re-modulating to prevent double-application of the same signals.
  // Only invoke DynamismEngine directly for sub-beat units (div/subdiv/subsubdiv)
  // that need per-unit pulse refinement.
  const needsPerUnitResolve = (unit !== 'beat');
  const resolved = (needsPerUnitResolve && typeof DynamismEngine !== 'undefined' && DynamismEngine && typeof DynamismEngine.resolve === 'function')
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
  const textureMode = (typeof TextureBlender !== 'undefined' && TextureBlender && typeof TextureBlender.resolve === 'function')
    ? TextureBlender.resolve(unit, Number(resolved.composite) || 0)
    : { mode: 'single', velocityScale: 1, sustainScale: 1 };

  // ── Emit texture-contrast event for drum coupling (#5) ─────────
  if (textureMode.mode !== 'single') {
    EventBus.emit(PLAY_EVENTS.TEXTURE_CONTRAST, { mode: textureMode.mode, unit, composite: Number(resolved.composite) || 0 });
  }

  // Per-layer + per-unit voice budget (prevents first-invocation dominance)
  try {
    const layerName = (typeof LM !== 'undefined' && LM && typeof LM.activeLayer === 'string') ? LM.activeLayer : 'L?';
    const unitBudgetKey = `${layerName}:${unit}:${Number.isFinite(Number(unitStart)) ? unitStart : 'u'}`;

    // Ensure per-layer budget maps exist (init.js defines these globals)
    if (!remainingVoiceSlotsByLayer || typeof remainingVoiceSlotsByLayer !== 'object') remainingVoiceSlotsByLayer = {};
    if (!lastVoiceBudgetKeyByLayer || typeof lastVoiceBudgetKeyByLayer !== 'object') lastVoiceBudgetKeyByLayer = {};

    if (lastVoiceBudgetKeyByLayer[layerName] !== unitBudgetKey) {
      const unitCfg = (unit === 'div') ? (typeof DIV_VOICES !== 'undefined' ? DIV_VOICES : BEAT_VOICES)
        : (unit === 'subdiv') ? (typeof SUBDIV_VOICES !== 'undefined' ? SUBDIV_VOICES : BEAT_VOICES)
        : (unit === 'subsubdiv') ? (typeof SUBSUBDIV_VOICES !== 'undefined' ? SUBSUBDIV_VOICES : BEAT_VOICES)
        : (typeof BEAT_VOICES !== 'undefined' ? BEAT_VOICES : VOICES);
      remainingVoiceSlotsByLayer[layerName] = (unitCfg && Number.isFinite(Number(unitCfg.max))) ? Number(unitCfg.max) : 4;
      lastVoiceBudgetKeyByLayer[layerName] = unitBudgetKey;
    }

    // Keep legacy globals in sync for backward compatibility
    remainingVoiceSlots = remainingVoiceSlotsByLayer[layerName];
    lastVoiceBudgetKey = `${layerName}:${lastVoiceBudgetKeyByLayer[layerName] || ''}`;
  } catch {
    /* ignore budget reset failures */
  }

  // Gate play invocation with playProb and crossModulation
  if (typeof resolvedPlayProb === 'number' && (rf() > resolvedPlayProb * rf(1,2)) && (crossModulation < rv(rf(1.8,2.2), [-.2, -.3], .05))) {
    emitNotesEmitted(0, intendedCount, 'probability-gate');
    return trackRhythm(unit, layer, false);
  }

  // Delegate motif selection and transformation to playMotifs
  const picks = playMotifs(unit, layer);
  intendedCount = Array.isArray(picks) ? picks.length : 0;

  // Apply voiceModulator to get per-pick velocity distribution
  // This gives each voice a slightly different velocity for natural ensemble feel
  if (typeof voiceModulator !== 'undefined' && voiceModulator && typeof voiceModulator.distribute === 'function' && Array.isArray(picks) && picks.length > 0) {
    const distributed = voiceModulator.distribute(picks.map(p => p.note), { baseVelocity: velocity, textureMode: textureMode.mode });
    for (let di = 0; di < m.min(distributed.length, picks.length); di++) {
      if (Number.isFinite(distributed[di].velocity)) picks[di]._distributedVelocity = distributed[di].velocity;
    }
  }

  // Enforce per-layer, per-unit remaining voice slots — trim picks if necessary
  try {
    if (Array.isArray(picks) && picks.length > 0) {
      const layerName = (typeof LM !== 'undefined' && LM && typeof LM.activeLayer === 'string') ? LM.activeLayer : 'L?';
      const available = Number.isFinite(Number(remainingVoiceSlotsByLayer && remainingVoiceSlotsByLayer[layerName] ? remainingVoiceSlotsByLayer[layerName] : remainingVoiceSlots))
        ? m.max(0, Number(remainingVoiceSlotsByLayer[layerName] ?? remainingVoiceSlots))
        : picks.length;
      const allowed = Number.isFinite(available) ? m.max(0, m.min(picks.length, available)) : picks.length;
      if (allowed <= 0) {
        // no budget available for this layer/unit — skip emission
        emitNotesEmitted(0, intendedCount, 'voice-budget');
        return trackRhythm(unit, layer, false);
      }
      if (allowed < picks.length) picks.length = allowed; // truncate in-place

      // Decrement per-layer budget and keep legacy global in sync
      if (!remainingVoiceSlotsByLayer) remainingVoiceSlotsByLayer = {};
      remainingVoiceSlotsByLayer[layerName] = m.max(0, (remainingVoiceSlotsByLayer[layerName] ?? remainingVoiceSlots) - picks.length);
      remainingVoiceSlots = remainingVoiceSlotsByLayer[layerName];
    }
  } catch {
    /* ignore budget enforcement failures */
  }

  try {
    if (typeof playNotesEmitPick !== 'function') {
      throw new Error(`${unit}.playNotes: playNotesEmitPick helper is not available`);
    }

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
