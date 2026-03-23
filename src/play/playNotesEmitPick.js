const V = validator.create('playNotesEmitPick');
const PLAY_NOTES_EMIT_PICK_PROFILE = process.argv.includes('--trace');
const PLAY_NOTES_EMIT_PICK_FAMILY_CENTERS = { source: 1.0, reflection: 0.98, bass: 1.02 };
const PLAY_NOTES_EMIT_PICK_FAMILY_COUPLING = { source: 0.52, reflection: 0.62, bass: 0.78 };
const PLAY_NOTES_EMIT_PICK_FAMILY_BOUNDS = {
  source: { min: 0.72, max: 1.1 },
  reflection: { min: 0.74, max: 1.06 },
  bass: { min: 0.8, max: 1.08 }
};
let playNotesEmitPickEmitPickDepsValidated = false;

// Beat-level channel cache - flipBin/source/reflection/bass don't change within a beat
let playNotesEmitPickChCacheBeat = -1;
let playNotesEmitPickChCacheFlip = /** @type {boolean|null} */ (null);
/** @type {any[]} */ let playNotesEmitPickCachedSourceChs = [];
/** @type {any[]} */ let playNotesEmitPickCachedReflectionChs = [];
/** @type {any[]} */ let playNotesEmitPickCachedBassChs = [];
let playNotesEmitPickChannelPoolsTrue = null;
let playNotesEmitPickChannelPoolsFalse = null;

// Beat-level feedback pitch bias - set once from processBeat, read per-pick
let playNotesEmitPickBeatFeedbackPitchBias = -1;
/** @param {number} bias */
setFeedbackPitchBias = function(bias) { playNotesEmitPickBeatFeedbackPitchBias = V.optionalFinite(bias, -1); };

// Beat-level climax modifiers cache - set once from processBeat, read per-pick
/** @type {{ playProbScale: number, velocityScale: number, registerBias: number, entropyTarget: number }} */
let playNotesEmitPickBeatClimaxMods = { playProbScale: 1, velocityScale: 1, registerBias: 0, entropyTarget: -1 };
/** @param {{ playProbScale: number, velocityScale: number, registerBias: number, entropyTarget: number }} mods */
setClimaxMods = function(mods) { playNotesEmitPickBeatClimaxMods = mods; };

function playNotesEmitPickBuildChannelPools(flip) {
  const pool = flip ? flipBinT : flipBinF;
  const poolSet = new Set(pool);
  return {
    source: source.filter(ch => poolSet.has(ch)),
    reflection: reflection.filter(ch => poolSet.has(ch)),
    bass: bass.filter(ch => poolSet.has(ch))
  };
}

function playNotesEmitPickRefreshChannelCache() {
  const key = beatStart;
  const flip = flipBin;
  if (playNotesEmitPickChCacheBeat === key && playNotesEmitPickChCacheFlip === flip) return;
  playNotesEmitPickChCacheBeat = key;
  playNotesEmitPickChCacheFlip = flip;
  const cachedPools = flip
    ? (playNotesEmitPickChannelPoolsTrue || (playNotesEmitPickChannelPoolsTrue = playNotesEmitPickBuildChannelPools(true)))
    : (playNotesEmitPickChannelPoolsFalse || (playNotesEmitPickChannelPoolsFalse = playNotesEmitPickBuildChannelPools(false)));
  playNotesEmitPickCachedSourceChs = cachedPools.source;
  playNotesEmitPickCachedReflectionChs = cachedPools.reflection;
  playNotesEmitPickCachedBassChs = cachedPools.bass;
}

function playNotesEmitPickChooseShift(pickNote, minNote, maxNote) {
  let selectedShift = 0;
  let candidateCount = 0;
  for (let mag = 1; mag <= 3; mag++) {
    const upShift = mag * 12;
    if (pickNote + upShift <= maxNote) {
      candidateCount++;
      if (candidateCount === 1 || rf() < (1 / candidateCount)) selectedShift = upShift;
    }
    const downShift = -mag * 12;
    if (pickNote + downShift >= minNote) {
      candidateCount++;
      if (candidateCount === 1 || rf() < (1 / candidateCount)) selectedShift = downShift;
    }
  }
  return candidateCount > 0 ? selectedShift : 0;
}

function playNotesEmitPickCoupleVelocity(rawVelocity, anchorVelocity, family) {
  const raw = V.requireFinite(rawVelocity, `${family}.rawVelocity`);
  const anchor = V.requireFinite(anchorVelocity, `${family}.anchorVelocity`);
  const familyCenter = PLAY_NOTES_EMIT_PICK_FAMILY_CENTERS[family];
  const coupling = PLAY_NOTES_EMIT_PICK_FAMILY_COUPLING[family];
  const target = clamp(anchor * familyCenter, 1, MIDI_MAX_VALUE);
  return clamp(m.round(raw * (1 - coupling) + target * coupling), 1, MIDI_MAX_VALUE);
}

function playNotesEmitPickFinalizeFamilyVelocity(rawVelocity, anchorVelocity, family) {
  const coupled = playNotesEmitPickCoupleVelocity(rawVelocity, anchorVelocity, family);
  const bounds = PLAY_NOTES_EMIT_PICK_FAMILY_BOUNDS[family];
  const minVelocity = clamp(m.round(anchorVelocity * bounds.min), 1, MIDI_MAX_VALUE);
  const maxVelocity = clamp(m.round(anchorVelocity * bounds.max), minVelocity, MIDI_MAX_VALUE);
  return clamp(coupled, minVelocity, maxVelocity);
}

function assertEmitPickDeps(unit) {
  if (playNotesEmitPickEmitPickDepsValidated) return;
  V.assertManagerShape(LM, 'LM', ['activate']);
  V.assertObject(LM.layers, 'LM.layers');
  V.assertNonEmptyString(LM.activeLayer, 'LM.activeLayer');
  V.assertManagerShape(absoluteTimeWindow, 'absoluteTimeWindow', ['recordNote', 'getNotes']);
  V.assertManagerShape(motifIdentityMemory, 'motifIdentityMemory', ['recordNote', 'getActiveIdentity']);
  V.assertManagerShape(convergenceDetector, 'convergenceDetector', ['postOnset', 'applyIfConverged', 'wasRecent']);
  V.assertObject(harmonicContext, 'harmonicContext');
  V.requireType(harmonicContext.getField, 'function', 'harmonicContext.getField');
  V.requireType(StutterManager, 'function', 'StutterManager');
  V.assertObject(StutterManager.beatContext, 'StutterManager.beatContext');
  if (!(StutterManager.beatContext.selectedReflectionChannels instanceof Set)) {
    throw new Error(`${unit}.playNotesEmitPick: StutterManager.beatContext.selectedReflectionChannels must be a Set`);
  }
  if (!(StutterManager.beatContext.selectedBassChannels instanceof Set)) {
    throw new Error(`${unit}.playNotesEmitPick: StutterManager.beatContext.selectedBassChannels must be a Set`);
  }
  playNotesEmitPickEmitPickDepsValidated = true;
}

playNotesEmitPick = function(opts = {}) {
  const playNotesEmitPickStartedAt = PLAY_NOTES_EMIT_PICK_PROFILE ? process.hrtime.bigint() : 0n;
  V.assertPlainObject(opts, 'opts');
  const {
    unit,
    pick,
    pickIndex,
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
  } = opts;

  V.assertObject(pick, 'pick');
  V.requireDefined(pick.note, 'pick.note');
  const minMidi = m.max(0, OCTAVE.min * 12);
  const maxMidi = m.min(MIDI_MAX_VALUE, OCTAVE.max * 12 - 1);
  const pickNote = modClamp(Number(pick.note), minMidi, maxMidi);

  let scheduled = 0;
  assertEmitPickDeps(unit);
  const activeLayerName = /** @type {string} */ (LM.activeLayer);

  // Cache timing globals once per call (they don't change within a beat)
  const playNotesEmitPickMStart = V.requireFinite(measureStart, 'measureStart');
  const playNotesEmitPickMStartTime = V.requireFinite(measureStartTime, 'measureStartTime');
  const playNotesEmitPickTpSec = V.requireFinite(tpSec, 'tpSec');

  /** @param {number} tick */
  const tickToAbsMs = (tick) => {
    return (playNotesEmitPickMStartTime + (tick - playNotesEmitPickMStart) / playNotesEmitPickTpSec) * 1000;
  };

  /** @param {number} tick @param {string} label */
  const ensureNonNegativeTick = (tick, label) => {
    const tickValue = V.requireFinite(tick, label);
    return tickValue < 0 ? 0 : tickValue;
  };

  const resolvedStutterProbValue = V.requireFinite(resolvedStutterProb, 'resolvedStutterProb');
  const shouldStutter = resolvedStutterProbValue > rf();
  const selectedShift = shouldStutter ? playNotesEmitPickChooseShift(pickNote, minMidi, maxMidi) : 0;

  const pickVelScale = Number.isFinite(pick.playNotesEmitPickDistributedVelocity)
    ? clamp(pick.playNotesEmitPickDistributedVelocity / m.max(1, velocity), 0.5, 1.5)
    : 1;

  playNotesEmitPickRefreshChannelCache();
  const activeSourceChannels = playNotesEmitPickCachedSourceChs;
  const maxTickShift = playNotesEmitPickTpSec * 0.1; // cap cumulative tick displacement to 10% of tpSec
  for (let sourceIndex = 0; sourceIndex < activeSourceChannels.length; sourceIndex++) {
    const sourceCH = activeSourceChannels[sourceIndex];
    const isPrimary = sourceCH === cCH1;
    let onTick = isPrimary ? on + rv(tpUnit * rf(1 / 9), [-0.1, 0.1], 0.3) : on + rv(tpUnit * rf(1 / 3), [-0.1, 0.1], 0.3);
    const preShiftTick = onTick;
    onTick = grooveTransfer.applyOffset(activeLayerName, onTick, unit);
    // Rhythmic complement: shift timing for hocket/antiphony/canon
    const rhythmComplement = rhythmicComplementEngine.suggestComplement(activeLayerName, onTick, tickToAbsMs(onTick));
    onTick = rhythmComplement.tick;
    const preSyncMs = tickToAbsMs(onTick);
    onTick = rhythmicPhaseLock.applyPhaseLock(preSyncMs, activeLayerName, onTick).tick;
    onTick = temporalGravity.applyGravity(preSyncMs, activeLayerName, onTick);
    // Cap cumulative tick displacement
    if (m.abs(onTick - preShiftTick) > maxTickShift) {
      onTick = preShiftTick + m.sign(onTick - preShiftTick) * maxTickShift;
    }
    onTick = ensureNonNegativeTick(onTick, `${unit}.source.onTick`);
    const absMsAtOnTick = tickToAbsMs(onTick);
    const baseOnVel = (isPrimary ? velocity * rf(0.96, 1.04) : binVel * rf(0.88, 0.96)) * pickVelScale;
    const sourceVoiceId = voiceIdSeed + sourceCH * 17 + pickIndex * 101 + sourceIndex;
    const sourceNoiseBase = baseOnVel * (1 - emissionCfg.sourceNoiseInfluence * noiseInfluence);
    const { perProbScaled: perProbScaledSrc, onVel } = getChannelCoherence(sourceCH, 'source', sourceNoiseBase, sourceVoiceId, currentTime);
    const coupledSourceVel = playNotesEmitPickCoupleVelocity(onVel, velocity, 'source');

    const applySelectedShiftToSource = isPrimary && selectedShift !== 0 && rf() < perProbScaledSrc;
    const noteToEmitBase = applySelectedShiftToSource
      ? modClamp(pickNote + selectedShift, minMidi, maxMidi)
      : pickNote;
    const noteAfterSpectral = spectralComplementarity.nudgeToFillGap(noteToEmitBase, activeLayerName).midi;
    // Pass pre-computed pitchBias from processBeat's feedbackOscillator call to avoid double-react
    const feedbackPitchBias = playNotesEmitPickBeatFeedbackPitchBias;
    const harmonicResult = harmonicIntervalGuard.nudgePitch(noteAfterSpectral, activeLayerName, absMsAtOnTick, feedbackPitchBias);
    const noteAfterHarmonic = harmonicResult.midi;
    const noteToEmit = registerCollisionAvoider.avoid(activeLayerName, noteAfterHarmonic, onTick, absMsAtOnTick).midi;

    const texVelBase = m.max(1, m.min(MIDI_MAX_VALUE, m.round(coupledSourceVel * textureMode.velocityScale)));
    const texVelRole = dynamicRoleSwap.modifyVelocity(activeLayerName, texVelBase);
    const texVelInterference = velocityInterference.applyInterference(absMsAtOnTick, activeLayerName, texVelRole).velocity;
    // Apply dynamic envelope and climax velocity scaling (cached per beat)
    const envelopeScale = crossLayerDynamicEnvelope.getVelocityScale(activeLayerName);
    const texVel = playNotesEmitPickFinalizeFamilyVelocity(
      V.requireFinite(m.max(1, m.min(MIDI_MAX_VALUE, m.round(texVelInterference * envelopeScale * playNotesEmitPickBeatClimaxMods.velocityScale))), 'texVel'),
      velocity,
      'source'
    );
    // Apply articulation complement sustain modifier
    const articulationMod = articulationComplement.getSustainModifier(activeLayerName);
    const texSustain = sustain * textureMode.sustainScale * articulationMod.sustainScale;

    const srcOnEvt = { tick: onTick, type: 'on', vals: [sourceCH, noteToEmit, texVel] };
    const sourceOffTickRaw = onTick + texSustain * (isPrimary ? 1 : rv(rf(0.92, 1.03)));
    const sourceOffTick = ensureNonNegativeTick(
      minimumNoteDuration.resolveOffTick(onTick, sourceOffTickRaw, 'core', tpUnit, `${unit}.source.offTickRaw`),
      `${unit}.source.offTick`
    );
    const srcOffEvt = { tick: sourceOffTick, vals: [sourceCH, noteToEmit] };
    microUnitAttenuator.record(srcOnEvt, srcOffEvt, crossModulation);
    traceDrain.recordFamilyVelocity('source', texVel);
    scheduled += 2;
    if (isPrimary) {
      registerCollisionAvoider.recordNote(activeLayerName, noteToEmit, onTick, absMsAtOnTick);
      grooveTransfer.recordTiming(activeLayerName, onTick, unit);
      // Embed emitted note into trace for downstream analytics (evolution #1)
      traceDrain.recordNote(noteToEmit, texVel, sourceCH);
      // Record articulation for cross-layer contrast tracking
      articulationComplement.recordSustain(activeLayerName, texSustain, absMsAtOnTick);
      // Record texture mode for texturalMirror
      V.assertObject(textureMode, 'textureMode');
      V.assertNonEmptyString(textureMode.mode, 'textureMode.mode');
      texturalMirror.recordTexture(activeLayerName, textureMode.mode, absMsAtOnTick);
    }

    // Record note into cross-layer tracking systems (convergence, spectral, motif echo, entropy, etc.)
    if (isPrimary) {
      scheduled += emitPickCrossLayerRecord({
        noteToEmit, texVel, activeLayerName, absMsAtOnTick, unit,
        onTick, sourceCH, tpUnit, texSustain,
        harmonicOtherMidi: harmonicResult.otherMidi
      });
    }

    if (isPrimary && (textureMode.mode === 'chordBurst' || textureMode.mode === 'flurry')) {
      scheduled += emitPickSourceTextures(textureMode.mode, {
        noteToEmit, texVel, onTick, tpUnit, texSustain, sourceCH,
        minMidi, maxMidi, sustainScale: textureMode.sustainScale
      });
    }
  }

  const activeReflectionChannels = playNotesEmitPickCachedReflectionChs;
  for (let reflectionIndex = 0; reflectionIndex < activeReflectionChannels.length; reflectionIndex++) {
    const reflectionCH = activeReflectionChannels[reflectionIndex];
    const isPrimary = reflectionCH === cCH2;
    let onTick = isPrimary ? on + rv(tpUnit * rf(0.2), [-0.01, 0.1], 0.5) : on + rv(tpUnit * rf(1 / 3), [-0.01, 0.1], 0.5);
    const reflPreShiftTick = onTick;
    onTick = grooveTransfer.applyOffset(activeLayerName, onTick, unit);
    const reflectionPreSyncMs = tickToAbsMs(onTick);
    onTick = rhythmicPhaseLock.applyPhaseLock(reflectionPreSyncMs, activeLayerName, onTick).tick;
    onTick = temporalGravity.applyGravity(reflectionPreSyncMs, activeLayerName, onTick);
    // Cap cumulative tick displacement to 10% of tpSec
    if (m.abs(onTick - reflPreShiftTick) > maxTickShift) {
      onTick = reflPreShiftTick + m.sign(onTick - reflPreShiftTick) * maxTickShift;
    }
    onTick = ensureNonNegativeTick(onTick, `${unit}.reflection.onTick`);
    const reflectionAbsMsAtOnTick = tickToAbsMs(onTick);
    const baseOnVel = (isPrimary ? velocity * rf(0.9, 1.02) : binVel * rf(0.84, 0.94)) * pickVelScale;
    const reflectionVoiceId = voiceIdSeed + reflectionCH * 19 + pickIndex * 131 + reflectionIndex;
    const reflectionNoiseBase = baseOnVel * (1 - emissionCfg.reflectionNoiseInfluence * noiseInfluence);
    const { perProbScaled: perProbScaledRefl, onVel: onVelRefl } = getChannelCoherence(reflectionCH, 'reflection', reflectionNoiseBase, reflectionVoiceId, currentTime);
    const coupledReflectionVel = playNotesEmitPickFinalizeFamilyVelocity(onVelRefl, velocity, 'reflection');

    const reflectSelected = StutterManager.beatContext.selectedReflectionChannels.has(reflectionCH);
    const reflectApplyShift = reflectSelected && selectedShift !== 0 && rf() < perProbScaledRefl;
    const reflectionEmitNoteBase = reflectApplyShift
      ? modClamp(pickNote + selectedShift, minMidi, maxMidi)
      : pickNote;
    const reflectionEmitNote = registerCollisionAvoider.avoid(activeLayerName, reflectionEmitNoteBase, onTick, reflectionAbsMsAtOnTick).midi;

    const reflOnEvt = { tick: onTick, type: 'on', vals: [reflectionCH, reflectionEmitNote, coupledReflectionVel] };
    const reflectionOffTickRaw = onTick + sustain * (isPrimary ? rf(0.7, 1.2) : rv(rf(0.65, 1.3)));
    const reflectionOffTick = ensureNonNegativeTick(
      minimumNoteDuration.resolveOffTick(onTick, reflectionOffTickRaw, 'core', tpUnit, `${unit}.reflection.offTickRaw`),
      `${unit}.reflection.offTick`
    );
    const reflOffEvt = { tick: reflectionOffTick, vals: [reflectionCH, reflectionEmitNote] };
    microUnitAttenuator.record(reflOnEvt, reflOffEvt, crossModulation);
    traceDrain.recordFamilyVelocity('reflection', coupledReflectionVel);
    scheduled += 2;
    if (isPrimary) {
      registerCollisionAvoider.recordNote(activeLayerName, reflectionEmitNote, onTick, reflectionAbsMsAtOnTick);
      grooveTransfer.recordTiming(activeLayerName, onTick, unit);
    }

    if (isPrimary && (textureMode.mode === 'chordBurst' || textureMode.mode === 'flurry')) {
      scheduled += emitPickReflectionTextures(textureMode.mode, {
        note: reflectionEmitNote, vel: coupledReflectionVel, onTick, tpUnit, sustain, ch: reflectionCH,
        minMidi, maxMidi, velocityScale: textureMode.velocityScale, sustainScale: textureMode.sustainScale
      });
    }
  }

  if (rf() < clamp(0.75 * bpmRatio3, 0.2, 0.7)) {
    const activeBassChannels = playNotesEmitPickCachedBassChs;
    for (let bassIndex = 0; bassIndex < activeBassChannels.length; bassIndex++) {
      const bassCH = activeBassChannels[bassIndex];
      const isPrimary = bassCH === cCH3;
      let onTick = isPrimary ? on + rv(tpUnit * rf(0.1), [-0.01, 0.1], 0.5) : on + rv(tpUnit * rf(1 / 3), [-0.01, 0.1], 0.5);
      const bassPreShiftTick = onTick;
      onTick = grooveTransfer.applyOffset(activeLayerName, onTick, unit);
      const bassPreSyncMs = tickToAbsMs(onTick);
      onTick = rhythmicPhaseLock.applyPhaseLock(bassPreSyncMs, activeLayerName, onTick).tick;
      onTick = temporalGravity.applyGravity(bassPreSyncMs, activeLayerName, onTick);
      // Cap cumulative tick displacement to 10% of tpSec
      if (m.abs(onTick - bassPreShiftTick) > maxTickShift) {
        onTick = bassPreShiftTick + m.sign(onTick - bassPreShiftTick) * maxTickShift;
      }
      onTick = ensureNonNegativeTick(onTick, `${unit}.bass.onTick`);
      const bassAbsMsAtOnTick = tickToAbsMs(onTick);
      const onVelRaw = (isPrimary ? velocity * rf(0.98, 1.08) : binVel * rf(0.92, 1.02)) * pickVelScale;
      const bassVoiceId = voiceIdSeed + bassCH * 23 + pickIndex * 151 + bassIndex;
      const bassNoiseBase = onVelRaw * (1 - emissionCfg.bassNoiseInfluence * noiseInfluence);
      const { perProbScaled: perProbScaledBass, onVel } = getChannelCoherence(bassCH, 'bass', bassNoiseBase, bassVoiceId, currentTime);
      const coupledBassVel = playNotesEmitPickFinalizeFamilyVelocity(onVel, velocity, 'bass');

      const bassSelected = StutterManager.beatContext.selectedBassChannels.has(bassCH);
      const bassApplyShift = bassSelected && selectedShift !== 0 && rf() < perProbScaledBass;
      const bassEmitBase = bassApplyShift ? pickNote + selectedShift : pickNote;
      const bassNoteBase = modClamp(bassEmitBase, minMidi, m.min(59, maxMidi));
      const bassNote = registerCollisionAvoider.avoid(activeLayerName, bassNoteBase, onTick, bassAbsMsAtOnTick).midi;

      const bassOnEvt = { tick: onTick, type: 'on', vals: [bassCH, bassNote, coupledBassVel] };
      const bassSustainScale = textureMode.mode === 'chordBurst' ? textureMode.sustainScale * rf(1.2, 1.6)
        : textureMode.mode === 'flurry' ? rf(1.3, 1.8)
        : 1;
      const bassOffTickRaw = onTick + sustain * bassSustainScale * (isPrimary ? rf(1.1, 3) : rv(rf(0.8, 3.5)));
      const bassOffTick = ensureNonNegativeTick(
        minimumNoteDuration.resolveOffTick(onTick, bassOffTickRaw, 'core', tpUnit, `${unit}.bass.offTickRaw`),
        `${unit}.bass.offTick`
      );
      const bassOffEvt = { tick: bassOffTick, vals: [bassCH, bassNote] };
      microUnitAttenuator.record(bassOnEvt, bassOffEvt, crossModulation);
      traceDrain.recordFamilyVelocity('bass', coupledBassVel);
      scheduled += 2;
      if (isPrimary) {
        registerCollisionAvoider.recordNote(activeLayerName, bassNote, onTick, bassAbsMsAtOnTick);
        grooveTransfer.recordTiming(activeLayerName, onTick, unit);
      }
    }
  }

  if (PLAY_NOTES_EMIT_PICK_PROFILE) traceDrain.recordRuntimeMetric(`playNotesEmitPick.${unit}`, Number(process.hrtime.bigint() - playNotesEmitPickStartedAt) / 1e6);
  return scheduled;
};
