const V = validator.create('playNotesEmitPick');
let _emitPickDepsValidated = false;

// Beat-level channel cache — flipBin/source/reflection/bass don't change within a beat
let _chCacheBeat = -1;
let _chCacheFlip = /** @type {boolean|null} */ (null);
/** @type {any[]} */ let _cachedSourceChs = [];
/** @type {any[]} */ let _cachedReflectionChs = [];
/** @type {any[]} */ let _cachedBassChs = [];

// Beat-level feedback pitch bias — set once from processBeat, read per-pick
let _beatFeedbackPitchBias = -1;
/** @param {number} bias */
setFeedbackPitchBias = function(bias) { _beatFeedbackPitchBias = V.optionalFinite(bias, -1); };

// Beat-level climax modifiers cache — set once from processBeat, read per-pick
/** @type {{ playProbScale: number, velocityScale: number, registerBias: number, entropyTarget: number }} */
let _beatClimaxMods = { playProbScale: 1, velocityScale: 1, registerBias: 0, entropyTarget: -1 };
/** @param {{ playProbScale: number, velocityScale: number, registerBias: number, entropyTarget: number }} mods */
setClimaxMods = function(mods) { _beatClimaxMods = mods; };

function _refreshChannelCache() {
  const key = beatStart;
  const flip = flipBin;
  if (_chCacheBeat === key && _chCacheFlip === flip) return;
  _chCacheBeat = key;
  _chCacheFlip = flip;
  const pool = flip ? flipBinT : flipBinF;
  const poolSet = new Set(pool);
  _cachedSourceChs = source.filter(ch => poolSet.has(ch));
  _cachedReflectionChs = reflection.filter(ch => poolSet.has(ch));
  _cachedBassChs = bass.filter(ch => poolSet.has(ch));
}

function assertEmitPickDeps(unit) {
  if (_emitPickDepsValidated) return;
  V.assertManagerShape(LM, 'LM', ['activate']);
  V.assertObject(LM.layers, 'LM.layers');
  V.assertNonEmptyString(LM.activeLayer, 'LM.activeLayer');
  V.assertManagerShape(absoluteTimeWindow, 'absoluteTimeWindow', ['recordNote', 'getNotes']);
  V.assertManagerShape(motifIdentityMemory, 'motifIdentityMemory', ['recordNote', 'getActiveIdentity']);
  V.assertManagerShape(convergenceDetector, 'convergenceDetector', ['postOnset', 'applyIfConverged', 'wasRecent']);
  V.assertObject(harmonicContext, 'harmonicContext');
  V.requireType(harmonicContext.getField, 'function', 'harmonicContext.getField');
  V.assertObject(stutter, 'stutter');
  V.assertObject(stutter.beatContext, 'stutter.beatContext');
  if (!(stutter.beatContext.selectedReflectionChannels instanceof Set)) {
    throw new Error(`${unit}.playNotesEmitPick: stutter.beatContext.selectedReflectionChannels must be a Set`);
  }
  if (!(stutter.beatContext.selectedBassChannels instanceof Set)) {
    throw new Error(`${unit}.playNotesEmitPick: stutter.beatContext.selectedBassChannels must be a Set`);
  }
  _emitPickDepsValidated = true;
}

playNotesEmitPick = function(opts = {}) {
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
  const _mStart = V.requireFinite(measureStart, 'measureStart');
  const _mStartTime = V.requireFinite(measureStartTime, 'measureStartTime');
  const _tpSec = V.requireFinite(tpSec, 'tpSec');

  /** @param {number} tick */
  const tickToAbsMs = (tick) => {
    return (_mStartTime + (tick - _mStart) / _tpSec) * 1000;
  };

  /** @param {number} tick @param {string} label */
  const ensureNonNegativeTick = (tick, label) => {
    const tickValue = V.requireFinite(tick, label);
    return tickValue < 0 ? 0 : tickValue;
  };

  const resolvedStutterProbValue = V.requireFinite(resolvedStutterProb, 'resolvedStutterProb');
  const shouldStutter = resolvedStutterProbValue > rf();
  let selectedShift = 0;
  if (shouldStutter) {
    const minNote = minMidi;
    const maxNote = maxMidi;
    const octaveCandidates = [];
    for (let mag = 1; mag <= 3; mag++) {
      if (pickNote + mag * 12 <= maxNote) octaveCandidates.push(mag * 12);
      if (pickNote - mag * 12 >= minNote) octaveCandidates.push(-mag * 12);
    }
    if (octaveCandidates.length > 0) {
      selectedShift = octaveCandidates[ri(octaveCandidates.length - 1)];
    }
  }

  const pickVelScale = Number.isFinite(pick._distributedVelocity)
    ? clamp(pick._distributedVelocity / m.max(1, velocity), 0.5, 1.5)
    : 1;

  _refreshChannelCache();
  const activeSourceChannels = _cachedSourceChs;
  const maxTickShift = tpSec * 0.1; // cap cumulative tick displacement to ±10% of tpSec
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
    const baseOnVel = (isPrimary ? velocity * rf(0.95, 1.15) : binVel * rf(0.75, 1.03)) * pickVelScale;
    const sourceVoiceId = voiceIdSeed + sourceCH * 17 + pickIndex * 101 + sourceIndex;
    const sourceNoiseBase = baseOnVel * (1 - emissionCfg.sourceNoiseInfluence * noiseInfluence);
    const { perProbScaled: perProbScaledSrc, onVel } = getChannelCoherence(sourceCH, 'source', sourceNoiseBase, sourceVoiceId, currentTime);

    const applySelectedShiftToSource = isPrimary && selectedShift !== 0 && rf() < perProbScaledSrc;
    const noteToEmitBase = applySelectedShiftToSource
      ? modClamp(pickNote + selectedShift, minMidi, maxMidi)
      : pickNote;
    const noteAfterSpectral = spectralComplementarity.nudgeToFillGap(noteToEmitBase, activeLayerName).midi;
    // Pass pre-computed pitchBias from processBeat's feedbackOscillator call to avoid double-react
    const feedbackPitchBias = _beatFeedbackPitchBias;
    const harmonicResult = harmonicIntervalGuard.nudgePitch(noteAfterSpectral, activeLayerName, absMsAtOnTick, feedbackPitchBias);
    const noteAfterHarmonic = harmonicResult.midi;
    const noteToEmit = registerCollisionAvoider.avoid(activeLayerName, noteAfterHarmonic, onTick).midi;

    const texVelBase = m.max(1, m.min(MIDI_MAX_VALUE, m.round(onVel * textureMode.velocityScale)));
    const texVelRole = dynamicRoleSwap.modifyVelocity(activeLayerName, texVelBase);
    const texVelInterference = velocityInterference.applyInterference(absMsAtOnTick, activeLayerName, texVelRole).velocity;
    // Apply dynamic envelope and climax velocity scaling (cached per beat)
    const envelopeScale = crossLayerDynamicEnvelope.getVelocityScale(activeLayerName);
    const texVel = V.requireFinite(m.max(1, m.min(MIDI_MAX_VALUE, m.round(texVelInterference * envelopeScale * _beatClimaxMods.velocityScale))), 'texVel');
    // Apply articulation complement sustain modifier
    const articulationMod = articulationComplement.getSustainModifier(activeLayerName);
    const texSustain = sustain * textureMode.sustainScale * articulationMod.sustainScale;

    const srcOnEvt = { tick: onTick, type: 'on', vals: [sourceCH, noteToEmit, texVel] };
    const sourceOffTick = ensureNonNegativeTick(on + texSustain * (isPrimary ? 1 : rv(rf(0.92, 1.03))), `${unit}.source.offTick`);
    const srcOffEvt = { tick: sourceOffTick, vals: [sourceCH, noteToEmit] };
    microUnitAttenuator.record(srcOnEvt, srcOffEvt, crossModulation);
    scheduled += 2;
    if (isPrimary) {
      registerCollisionAvoider.recordNote(activeLayerName, noteToEmit, onTick);
      grooveTransfer.recordTiming(activeLayerName, onTick, unit);
      // Record articulation for cross-layer contrast tracking
      articulationComplement.recordSustain(activeLayerName, texSustain, absMsAtOnTick);
      // Record texture mode for texturalMirror
      if (!textureMode || typeof textureMode.mode !== 'string' || textureMode.mode.length === 0) {
        throw new Error(`${unit}.playNotesEmitPick: textureMode.mode must be a non-empty string`);
      }
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

  const activeReflectionChannels = _cachedReflectionChs;
  for (let reflectionIndex = 0; reflectionIndex < activeReflectionChannels.length; reflectionIndex++) {
    const reflectionCH = activeReflectionChannels[reflectionIndex];
    const isPrimary = reflectionCH === cCH2;
    let onTick = isPrimary ? on + rv(tpUnit * rf(0.2), [-0.01, 0.1], 0.5) : on + rv(tpUnit * rf(1 / 3), [-0.01, 0.1], 0.5);
    const reflPreShiftTick = onTick;
    onTick = grooveTransfer.applyOffset(activeLayerName, onTick, unit);
    const reflectionPreSyncMs = tickToAbsMs(onTick);
    onTick = rhythmicPhaseLock.applyPhaseLock(reflectionPreSyncMs, activeLayerName, onTick).tick;
    onTick = temporalGravity.applyGravity(reflectionPreSyncMs, activeLayerName, onTick);
    // Cap cumulative tick displacement to ±10% of tpSec
    if (m.abs(onTick - reflPreShiftTick) > maxTickShift) {
      onTick = reflPreShiftTick + m.sign(onTick - reflPreShiftTick) * maxTickShift;
    }
    onTick = ensureNonNegativeTick(onTick, `${unit}.reflection.onTick`);
    const baseOnVel = (isPrimary ? velocity * rf(0.7, 1.2) : binVel * rf(0.55, 1.1)) * pickVelScale;
    const reflectionVoiceId = voiceIdSeed + reflectionCH * 19 + pickIndex * 131 + reflectionIndex;
    const reflectionNoiseBase = baseOnVel * (1 - emissionCfg.reflectionNoiseInfluence * noiseInfluence);
    const { perProbScaled: perProbScaledRefl, onVel: onVelRefl } = getChannelCoherence(reflectionCH, 'reflection', reflectionNoiseBase, reflectionVoiceId, currentTime);

    const reflectSelected = stutter.beatContext.selectedReflectionChannels.has(reflectionCH);
    const reflectApplyShift = reflectSelected && selectedShift !== 0 && rf() < perProbScaledRefl;
    const reflectionEmitNoteBase = reflectApplyShift
      ? modClamp(pickNote + selectedShift, minMidi, maxMidi)
      : pickNote;
    const reflectionEmitNote = registerCollisionAvoider.avoid(activeLayerName, reflectionEmitNoteBase, onTick).midi;

    const reflOnEvt = { tick: onTick, type: 'on', vals: [reflectionCH, reflectionEmitNote, onVelRefl] };
    const reflectionOffTick = ensureNonNegativeTick(on + sustain * (isPrimary ? rf(0.7, 1.2) : rv(rf(0.65, 1.3))), `${unit}.reflection.offTick`);
    const reflOffEvt = { tick: reflectionOffTick, vals: [reflectionCH, reflectionEmitNote] };
    microUnitAttenuator.record(reflOnEvt, reflOffEvt, crossModulation);
    scheduled += 2;
    if (isPrimary) {
      registerCollisionAvoider.recordNote(activeLayerName, reflectionEmitNote, onTick);
      grooveTransfer.recordTiming(activeLayerName, onTick, unit);
    }

    if (isPrimary && (textureMode.mode === 'chordBurst' || textureMode.mode === 'flurry')) {
      scheduled += emitPickReflectionTextures(textureMode.mode, {
        note: reflectionEmitNote, vel: onVelRefl, onTick, tpUnit, sustain, ch: reflectionCH,
        minMidi, maxMidi, velocityScale: textureMode.velocityScale, sustainScale: textureMode.sustainScale
      });
    }
  }

  if (rf() < clamp(0.75 * bpmRatio3, 0.2, 0.7)) {
    const activeBassChannels = _cachedBassChs;
    for (let bassIndex = 0; bassIndex < activeBassChannels.length; bassIndex++) {
      const bassCH = activeBassChannels[bassIndex];
      const isPrimary = bassCH === cCH3;
      let onTick = isPrimary ? on + rv(tpUnit * rf(0.1), [-0.01, 0.1], 0.5) : on + rv(tpUnit * rf(1 / 3), [-0.01, 0.1], 0.5);
      const bassPreShiftTick = onTick;
      onTick = grooveTransfer.applyOffset(activeLayerName, onTick, unit);
      const bassPreSyncMs = tickToAbsMs(onTick);
      onTick = rhythmicPhaseLock.applyPhaseLock(bassPreSyncMs, activeLayerName, onTick).tick;
      onTick = temporalGravity.applyGravity(bassPreSyncMs, activeLayerName, onTick);
      // Cap cumulative tick displacement to ±10% of tpSec
      if (m.abs(onTick - bassPreShiftTick) > maxTickShift) {
        onTick = bassPreShiftTick + m.sign(onTick - bassPreShiftTick) * maxTickShift;
      }
      onTick = ensureNonNegativeTick(onTick, `${unit}.bass.onTick`);
      const onVelRaw = (isPrimary ? velocity * rf(1.15, 1.5) : binVel * rf(1.85, 2.5)) * pickVelScale;
      const bassVoiceId = voiceIdSeed + bassCH * 23 + pickIndex * 151 + bassIndex;
      const bassNoiseBase = onVelRaw * (1 - emissionCfg.bassNoiseInfluence * noiseInfluence);
      const { perProbScaled: perProbScaledBass, onVel } = getChannelCoherence(bassCH, 'bass', bassNoiseBase, bassVoiceId, currentTime);

      const bassSelected = stutter.beatContext.selectedBassChannels.has(bassCH);
      const bassApplyShift = bassSelected && selectedShift !== 0 && rf() < perProbScaledBass;
      const bassEmitBase = bassApplyShift ? pickNote + selectedShift : pickNote;
      const bassNoteBase = modClamp(bassEmitBase, minMidi, m.min(59, maxMidi));
      const bassNote = registerCollisionAvoider.avoid(activeLayerName, bassNoteBase, onTick).midi;

      const bassOnEvt = { tick: onTick, type: 'on', vals: [bassCH, bassNote, onVel] };
      const bassSustainScale = textureMode.mode === 'chordBurst' ? textureMode.sustainScale * rf(1.2, 1.6)
        : textureMode.mode === 'flurry' ? rf(1.3, 1.8)
        : 1;
      const bassOffTick = ensureNonNegativeTick(on + sustain * bassSustainScale * (isPrimary ? rf(1.1, 3) : rv(rf(0.8, 3.5))), `${unit}.bass.offTick`);
      const bassOffEvt = { tick: bassOffTick, vals: [bassCH, bassNote] };
      microUnitAttenuator.record(bassOnEvt, bassOffEvt, crossModulation);
      scheduled += 2;
      if (isPrimary) {
        registerCollisionAvoider.recordNote(activeLayerName, bassNote, onTick);
        grooveTransfer.recordTiming(activeLayerName, onTick, unit);
      }
    }
  }

  return scheduled;
};
