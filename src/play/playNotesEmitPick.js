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

// Beat-level feedback energy cache - modulates stutter probability
let playNotesEmitPickBeatFeedbackEnergy = 0;
/** @param {number} energy */
setFeedbackStutterEnergy = function(energy) { playNotesEmitPickBeatFeedbackEnergy = V.optionalFinite(energy, 0); };

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

let playNotesEmitPickChCacheLayer = '';
function playNotesEmitPickRefreshChannelCache() {
  const key = beatStartTime;
  const flip = flipBin;
  const layer = (LM && LM.activeLayer) ? LM.activeLayer : '';
  if (playNotesEmitPickChCacheBeat === key && playNotesEmitPickChCacheFlip === flip && playNotesEmitPickChCacheLayer === layer) return;
  playNotesEmitPickChCacheBeat = key;
  playNotesEmitPickChCacheFlip = flip;
  playNotesEmitPickChCacheLayer = layer;
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
  V.assertManagerShape(L0, 'L0', ['post', 'query']);
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
    spUnit,
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

  /** @param {number} timeInSeconds @param {string} label */
  const ensureNonNegativeTime = (timeInSeconds, label) => {
    const t = V.requireFinite(timeInSeconds, label);
    return t < 0 ? 0 : t;
  };

  const resolvedStutterProbValue = V.requireFinite(resolvedStutterProb, 'resolvedStutterProb');
  // Lab R3: perProb was a separate gate creating compound suppression (85% perProb * 40%
  // conductorProb = 34% actual). Now perProb amplifies the conductor probability so
  // high perProb profiles actually produce dense stutters.
  const maxPerProb = m.max(
    stutterConfig.getProfileConfig('source').perProb,
    stutterConfig.getProfileConfig('reflection').perProb,
    stutterConfig.getProfileConfig('bass').perProb
  );
  const stutterProbAmplified = clamp(resolvedStutterProbValue * (0.6 + maxPerProb * 0.8), 0, 1);
  const shouldStutter = stutterProbAmplified > rf();
  const selectedShift = shouldStutter ? playNotesEmitPickChooseShift(pickNote, minMidi, maxMidi) : 0;

  const pickVelScale = Number.isFinite(pick.playNotesEmitPickDistributedVelocity)
    ? clamp(pick.playNotesEmitPickDistributedVelocity / m.max(1, velocity), 0.5, 1.5)
    : 1;

  playNotesEmitPickRefreshChannelCache();
  const activeSourceChannels = playNotesEmitPickCachedSourceChs;
  const maxTimeShift = spBeat * 0.1; // cap cumulative time displacement to 10% of spBeat
  for (let sourceIndex = 0; sourceIndex < activeSourceChannels.length; sourceIndex++) {
    const sourceCH = activeSourceChannels[sourceIndex];
    const isPrimary = sourceCH === cCH1;
    let onTime = isPrimary ? on + rv(spUnit * rf(1 / 9), [-0.1, 0.1], 0.3) : on + rv(spUnit * rf(1 / 3), [-0.1, 0.1], 0.3);
    const preShiftTime = onTime;
    onTime = grooveTransfer.applyOffset(activeLayerName, onTime, unit);
    // Rhythmic complement: shift timing for hocket/antiphony/canon
    const rhythmComplement = rhythmicComplementEngine.suggestComplement(activeLayerName, onTime, onTime);
    onTime = rhythmComplement.time;
    onTime = rhythmicPhaseLock.applyPhaseLock(onTime, activeLayerName, onTime).time;
    onTime = temporalGravity.applyGravity(onTime, activeLayerName, onTime);
    // Cap cumulative time displacement
    if (m.abs(onTime - preShiftTime) > maxTimeShift) {
      onTime = preShiftTime + m.sign(onTime - preShiftTime) * maxTimeShift;
    }
    onTime = ensureNonNegativeTime(onTime, `${unit}.source.onTime`);
    // Convergence velocity surge: brief boost at convergence points
    const convergeSurge = isPrimary ? convergenceVelocitySurge.check(onTime, activeLayerName) : 1.0;
    const baseOnVel = (isPrimary ? velocity * rf(0.96, 1.04) : binVel * rf(0.88, 0.96)) * pickVelScale * convergeSurge;
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
    const harmonicResult = harmonicIntervalGuard.nudgePitch(noteAfterSpectral, activeLayerName, onTime, feedbackPitchBias);
    const noteAfterHarmonic = harmonicResult.midi;
    const noteToEmit = registerCollisionAvoider.avoid(activeLayerName, noteAfterHarmonic, onTime).midi;

    const texVelBase = m.max(1, m.min(MIDI_MAX_VALUE, m.round(coupledSourceVel * textureMode.velocityScale)));
    const texVelRole = dynamicRoleSwap.modifyVelocity(activeLayerName, texVelBase);
    const texVelInterference = velocityInterference.applyInterference(onTime, activeLayerName, texVelRole).velocity;
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

    const srcOnEvt = { timeInSeconds: onTime, type: 'on', vals: [sourceCH, noteToEmit, texVel] };
    const sourceOffTimeRaw = onTime + texSustain * (isPrimary ? 1 : rv(rf(0.92, 1.03)));
    const sourceOffTime = ensureNonNegativeTime(
      minimumNoteDuration.resolveOffTime(onTime, sourceOffTimeRaw, 'core', spUnit, `${unit}.source.offTimeRaw`),
      `${unit}.source.offTime`
    );
    const srcOffEvt = { timeInSeconds: sourceOffTime, vals: [sourceCH, noteToEmit] };
    microUnitAttenuator.record(srcOnEvt, srcOffEvt, crossModulation);
    traceDrain.recordFamilyVelocity('source', texVel);
    scheduled += 2;
    if (isPrimary) {
      registerCollisionAvoider.recordNote(activeLayerName, noteToEmit, onTime);
      grooveTransfer.recordTiming(activeLayerName, onTime, unit);
      // R36: emission accountability -- post what actually happened vs what was selected
      const pitchDelta = noteToEmit - pickNote;
      const timeDelta = onTime - preShiftTime;
      if (pitchDelta !== 0 || m.abs(timeDelta) > 0.001) {
        L0.post(L0_CHANNELS.emissionDelta, activeLayerName, onTime, {
          selected: pickNote, emitted: noteToEmit, pitchDelta,
          timeDelta: Number(timeDelta.toFixed(4)),
          stuttered: shouldStutter, shift: selectedShift
        });
      }
      // Embed emitted note into trace for downstream analytics (evolution #1)
      traceDrain.recordNote(noteToEmit, texVel, sourceCH);
      // Record articulation for cross-layer contrast tracking
      articulationComplement.recordSustain(activeLayerName, texSustain, onTime);
      // Record texture mode for texturalMirror
      V.assertObject(textureMode, 'textureMode');
      V.assertNonEmptyString(textureMode.mode, 'textureMode.mode');
      texturalMirror.recordTexture(activeLayerName, textureMode.mode, onTime);
    }

    // Stutter echo: emit a separate octave-shifted note after the source note.
    // Lab R11: echo probability scaled by sustain relative to spBeat. Short
    // subdivision notes (low sustain) are mostly gated out since they already
    // crowd the buffer. Beat-length notes get the full 0.35 base probability.
    // Lab R12: sustain-proportional gating - shorter notes get exponentially
    // less likely to stutter, preventing low-unit note floods.
    // R18: suppress stutter echoes on resting layers - respect musical silence
    if (shouldStutter && isPrimary && !restSynchronizer.isLayerResting(activeLayerName)) {
      // R16: sustainRatio^1.5 (was ^2) - all ecosystem tests great including
      // dense polyrhythm, so soften the subdivision suppression. Base prob
      // raised 0.35->0.45 - stress test at 0.65 stutterProb was great.
      const sustainRatio = clamp(texSustain / m.max(0.01, spBeat), 0, 1);
      const feedbackBoost = 1 + playNotesEmitPickBeatFeedbackEnergy * 1.5;
      // R18: emission gap compensation - when notes fail to emit, boost stutter
      const emissionGap = safePreBoot.call(() => emissionFeedbackListener.getEmissionGap(), 0);
      const emissionBoost = 1 + clamp(emissionGap, 0, 0.5) * 0.8;
      // R26: tension-scaled stutter density - high tension = more stutter
      const tensionSigs = conductorSignalBridge.getSignals();
      const tensionScale = clamp(tensionSigs.tension * 0.8 + 0.2, 0.5, 1.5);
      // R26: density-inverse stutter - sparse passages get more stutter
      const densityScale = clamp(1.5 - tensionSigs.density, 0.6, 1.8);
      // R26: anticipatory stutter - ramp in last 20% of phrase based on tension trajectory
      const phrasePos = /** @type {number} */ (timeStream.normalizedProgress('phrase'));
      const inRamp = Number.isFinite(phrasePos) && phrasePos > 0.80;
      const tensionTraj = safePreBoot.call(() => sectionMemory.getTensionTrajectory(), 0);
      const rampScale = inRamp ? clamp(1.0 + /** @type {number} */ (tensionTraj) * 2 * (phrasePos - 0.80) / 0.20, 0.7, 1.5) : 1.0;
      // R26: phrase-start suppression - less stutter in first 10% for clean phrase entry
      const startSuppress = (Number.isFinite(phrasePos) && phrasePos < 0.10) ? 0.4 : 1.0;
      // R26: convergence memory boost at historically high-convergence positions
      const convMemBoost = safePreBoot.call(() => convergenceMemory.getBoost(), 1.0);
      const stutterEchoProb = 0.45 * m.pow(sustainRatio, 1.5) * feedbackBoost * emissionBoost * tensionScale * densityScale * rampScale * startSuppress * /** @type {number} */ (convMemBoost);
      if (rf() < stutterEchoProb) {
        StutterManager.scheduleStutterForUnit({
          profile: 'source',
          channel: sourceCH,
          note: noteToEmit,
          on: onTime,
          sustain: texSustain,
          velocity: clamp(m.round(texVel * rf(0.35, 0.65)), 1, MIDI_MAX_VALUE),
          binVel: clamp(m.round(texVel * rf(0.35, 0.65)), 1, MIDI_MAX_VALUE),
          isPrimary: true
        });
      }
    }

    // Record note into cross-layer tracking systems (convergence, spectral, motif echo, entropy, etc.)
    if (isPrimary) {
      scheduled += emitPickCrossLayerRecord({
        noteToEmit, texVel, activeLayerName, unit,
        onTime, sourceCH, spUnit, texSustain,
        harmonicOtherMidi: harmonicResult.otherMidi
      });
    }

    if (isPrimary && (textureMode.mode === 'chordBurst' || textureMode.mode === 'flurry')) {
      scheduled += emitPickSourceTextures(textureMode.mode, {
        noteToEmit, texVel, onTime, spUnit, texSustain, sourceCH,
        minMidi, maxMidi, sustainScale: textureMode.sustainScale
      });
    }
  }

  const activeReflectionChannels = playNotesEmitPickCachedReflectionChs;
  for (let reflectionIndex = 0; reflectionIndex < activeReflectionChannels.length; reflectionIndex++) {
    const reflectionCH = activeReflectionChannels[reflectionIndex];
    const isPrimary = reflectionCH === cCH2;
    let onTime = isPrimary ? on + rv(spUnit * rf(0.2), [-0.01, 0.1], 0.5) : on + rv(spUnit * rf(1 / 3), [-0.01, 0.1], 0.5);
    const reflPreShiftTime = onTime;
    onTime = grooveTransfer.applyOffset(activeLayerName, onTime, unit);
    const reflectionPreSync = onTime;
    onTime = rhythmicPhaseLock.applyPhaseLock(reflectionPreSync, activeLayerName, onTime).time;
    onTime = temporalGravity.applyGravity(reflectionPreSync, activeLayerName, onTime);
    // Cap cumulative time displacement to 10% of spBeat
    if (m.abs(onTime - reflPreShiftTime) > maxTimeShift) {
      onTime = reflPreShiftTime + m.sign(onTime - reflPreShiftTime) * maxTimeShift;
    }
    onTime = ensureNonNegativeTime(onTime, `${unit}.reflection.onTime`);

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
    const reflectionEmitNote = registerCollisionAvoider.avoid(activeLayerName, reflectionEmitNoteBase, onTime).midi;

    const reflOnEvt = { timeInSeconds: onTime, type: 'on', vals: [reflectionCH, reflectionEmitNote, coupledReflectionVel] };
    const reflectionOffTimeRaw = onTime + sustain * (isPrimary ? rf(0.7, 1.2) : rv(rf(0.65, 1.3)));
    const reflectionOffTime = ensureNonNegativeTime(
      minimumNoteDuration.resolveOffTime(onTime, reflectionOffTimeRaw, 'core', spUnit, `${unit}.reflection.offTimeRaw`),
      `${unit}.reflection.offTime`
    );
    const reflOffEvt = { timeInSeconds: reflectionOffTime, vals: [reflectionCH, reflectionEmitNote] };
    microUnitAttenuator.record(reflOnEvt, reflOffEvt, crossModulation);
    traceDrain.recordFamilyVelocity('reflection', coupledReflectionVel);
    scheduled += 2;
    if (isPrimary) {
      registerCollisionAvoider.recordNote(activeLayerName, reflectionEmitNote, onTime);
      grooveTransfer.recordTiming(activeLayerName, onTime, unit);
    }

    if (isPrimary && (textureMode.mode === 'chordBurst' || textureMode.mode === 'flurry')) {
      scheduled += emitPickReflectionTextures(textureMode.mode, {
        note: reflectionEmitNote, vel: coupledReflectionVel, onTime, spUnit, sustain, ch: reflectionCH,
        minMidi, maxMidi, velocityScale: textureMode.velocityScale, sustainScale: textureMode.sustainScale
      });
    }
  }

  if (rf() < clamp(0.75 * bpmRatio3, 0.2, 0.7)) {
    const activeBassChannels = playNotesEmitPickCachedBassChs;
    for (let bassIndex = 0; bassIndex < activeBassChannels.length; bassIndex++) {
      const bassCH = activeBassChannels[bassIndex];
      const isPrimary = bassCH === cCH3;
      let onTime = isPrimary ? on + rv(spUnit * rf(0.1), [-0.01, 0.1], 0.5) : on + rv(spUnit * rf(1 / 3), [-0.01, 0.1], 0.5);
      const bassPreShiftTime = onTime;
      onTime = grooveTransfer.applyOffset(activeLayerName, onTime, unit);
      const bassPreSync = onTime;
      onTime = rhythmicPhaseLock.applyPhaseLock(bassPreSync, activeLayerName, onTime).time;
      onTime = temporalGravity.applyGravity(bassPreSync, activeLayerName, onTime);
      // Cap cumulative time displacement to 10% of spBeat
      if (m.abs(onTime - bassPreShiftTime) > maxTimeShift) {
        onTime = bassPreShiftTime + m.sign(onTime - bassPreShiftTime) * maxTimeShift;
      }
      onTime = ensureNonNegativeTime(onTime, `${unit}.bass.onTime`);

      const onVelRaw = (isPrimary ? velocity * rf(0.98, 1.08) : binVel * rf(0.92, 1.02)) * pickVelScale;
      const bassVoiceId = voiceIdSeed + bassCH * 23 + pickIndex * 151 + bassIndex;
      const bassNoiseBase = onVelRaw * (1 - emissionCfg.bassNoiseInfluence * noiseInfluence);
      const { perProbScaled: perProbScaledBass, onVel } = getChannelCoherence(bassCH, 'bass', bassNoiseBase, bassVoiceId, currentTime);
      const coupledBassVel = playNotesEmitPickFinalizeFamilyVelocity(onVel, velocity, 'bass');

      const bassSelected = StutterManager.beatContext.selectedBassChannels.has(bassCH);
      const bassApplyShift = bassSelected && selectedShift !== 0 && rf() < perProbScaledBass;
      const bassEmitBase = bassApplyShift ? pickNote + selectedShift : pickNote;
      const bassNoteBase = modClamp(bassEmitBase, minMidi, m.min(59, maxMidi));
      const bassNote = registerCollisionAvoider.avoid(activeLayerName, bassNoteBase, onTime).midi;

      const bassOnEvt = { timeInSeconds: onTime, type: 'on', vals: [bassCH, bassNote, coupledBassVel] };
      const bassSustainScale = textureMode.mode === 'chordBurst' ? textureMode.sustainScale * rf(1.2, 1.6)
        : textureMode.mode === 'flurry' ? rf(1.3, 1.8)
        : 1;
      const bassOffTimeRaw = onTime + sustain * bassSustainScale * (isPrimary ? rf(1.1, 3) : rv(rf(0.8, 3.5)));
      const bassOffTime = ensureNonNegativeTime(
        minimumNoteDuration.resolveOffTime(onTime, bassOffTimeRaw, 'core', spUnit, `${unit}.bass.offTimeRaw`),
        `${unit}.bass.offTime`
      );
      const bassOffEvt = { timeInSeconds: bassOffTime, vals: [bassCH, bassNote] };
      microUnitAttenuator.record(bassOnEvt, bassOffEvt, crossModulation);
      traceDrain.recordFamilyVelocity('bass', coupledBassVel);
      scheduled += 2;
      if (isPrimary) {
        registerCollisionAvoider.recordNote(activeLayerName, bassNote, onTime);
        grooveTransfer.recordTiming(activeLayerName, onTime, unit);
      }
    }
  }

  if (PLAY_NOTES_EMIT_PICK_PROFILE) traceDrain.recordRuntimeMetric(`playNotesEmitPick.${unit}`, Number(process.hrtime.bigint() - playNotesEmitPickStartedAt) / 1e6);
  return scheduled;
};
