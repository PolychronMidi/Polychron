playNotesEmitPick = function(opts = {}) {
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

  if (!pick || typeof pick.note === 'undefined') {
    throw new Error(`${unit}.playNotes: invalid note object in motif picks`);
  }

  let scheduled = 0;
  const activeLayerName = (typeof LM !== 'undefined' && LM && typeof LM.activeLayer === 'string') ? LM.activeLayer : 'L?';

  /** @param {number} tick */
  const tickToAbsMs = (tick) => {
    if (Number.isFinite(measureStart) && Number.isFinite(measureStartTime) && Number.isFinite(tpSec)) {
      return (measureStartTime + (tick - measureStart) / tpSec) * 1000;
    }
    return Number.isFinite(beatStartTime) ? beatStartTime * 1000 : 0;
  };

  const shouldStutter = (typeof resolvedStutterProb === 'number') ? (resolvedStutterProb > rf()) : false;
  let selectedShift = 0;
  if (shouldStutter) {
    const minNote = m.max(0, OCTAVE.min * 12 - 1);
    const maxNote = OCTAVE.max * 12 - 1;
    const octaveCandidates = [];
    for (let mag = 1; mag <= 3; mag++) {
      if (pick.note + mag * 12 <= maxNote) octaveCandidates.push(mag * 12);
      if (pick.note - mag * 12 >= minNote) octaveCandidates.push(-mag * 12);
    }
    if (octaveCandidates.length > 0) {
      selectedShift = octaveCandidates[ri(octaveCandidates.length - 1)];
    }
  }

  const pickVelScale = (pick._distributedVelocity && Number.isFinite(pick._distributedVelocity))
    ? clamp(pick._distributedVelocity / m.max(1, velocity), 0.5, 1.5)
    : 1;

  const activeSourceChannels = source.filter(ch => flipBin ? flipBinT.includes(ch) : flipBinF.includes(ch));
  for (let sourceIndex = 0; sourceIndex < activeSourceChannels.length; sourceIndex++) {
    const sourceCH = activeSourceChannels[sourceIndex];
    const isPrimary = sourceCH === cCH1;
    let onTick = isPrimary ? on + rv(tpUnit * rf(1 / 9), [-0.1, 0.1], 0.3) : on + rv(tpUnit * rf(1 / 3), [-0.1, 0.1], 0.3);
    onTick = GrooveTransfer.applyOffset(activeLayerName, onTick, unit);
    // Rhythmic complement: shift timing for hocket/antiphony/canon
    const rhythmComplement = RhythmicComplementEngine.suggestComplement(activeLayerName, onTick, tickToAbsMs(onTick));
    onTick = rhythmComplement.tick;
    const preSyncMs = tickToAbsMs(onTick);
    onTick = RhythmicPhaseLock.applyPhaseLock(preSyncMs, activeLayerName, onTick).tick;
    onTick = TemporalGravity.applyGravity(preSyncMs, activeLayerName, onTick);
    const absMsAtOnTick = tickToAbsMs(onTick);
    const baseOnVel = (isPrimary ? velocity * rf(0.95, 1.15) : binVel * rf(0.75, 1.03)) * pickVelScale;
    const sourceVoiceId = voiceIdSeed + sourceCH * 17 + pickIndex * 101 + sourceIndex;
    const sourceNoiseBase = baseOnVel * (1 - emissionCfg.sourceNoiseInfluence * noiseInfluence);
    const { perProbScaled: perProbScaledSrc, onVel } = getChannelCoherence(sourceCH, 'source', sourceNoiseBase, sourceVoiceId, currentTime);

    const applySelectedShiftToSource = isPrimary && selectedShift !== 0 && rf() < perProbScaledSrc;
    const noteToEmitBase = applySelectedShiftToSource
      ? modClamp(pick.note + selectedShift, m.max(0, OCTAVE.min * 12 - 1), OCTAVE.max * 12 - 1)
      : pick.note;
    const noteAfterSpectral = SpectralComplementarity.nudgeToFillGap(noteToEmitBase, activeLayerName).midi;
    const noteAfterHarmonic = HarmonicIntervalGuard.nudgePitch(noteAfterSpectral, activeLayerName, absMsAtOnTick).midi;
    const noteToEmit = RegisterCollisionAvoider.avoid(activeLayerName, noteAfterHarmonic, onTick).midi;

    const texVelBase = m.max(1, m.min(MIDI_MAX_VALUE, m.round(onVel * textureMode.velocityScale)));
    const texVelRole = DynamicRoleSwap.modifyVelocity(activeLayerName, texVelBase);
    const texVelInterference = VelocityInterference.applyInterference(absMsAtOnTick, activeLayerName, texVelRole).velocity;
    // Apply dynamic envelope and climax velocity scaling
    const envelopeScale = CrossLayerDynamicEnvelope.getVelocityScale(activeLayerName);
    const climaxMods = CrossLayerClimaxEngine.getModifiers(activeLayerName);
    const texVel = m.max(1, m.min(MIDI_MAX_VALUE, m.round(texVelInterference * envelopeScale * climaxMods.velocityScale)));
    // Apply articulation complement sustain modifier
    const articulationMod = ArticulationComplement.getSustainModifier(activeLayerName);
    const texSustain = sustain * textureMode.sustainScale * articulationMod.sustainScale;

    const srcOnEvt = { tick: onTick, type: 'on', vals: [sourceCH, noteToEmit, texVel] };
    const sourceOffTick = on + texSustain * (isPrimary ? 1 : rv(rf(0.92, 1.03)));
    const srcOffEvt = { tick: sourceOffTick, vals: [sourceCH, noteToEmit] };
    microUnitAttenuator.record(srcOnEvt, srcOffEvt, crossModulation);
    scheduled += 2;
    if (isPrimary) {
      RegisterCollisionAvoider.recordNote(activeLayerName, noteToEmit, onTick);
      GrooveTransfer.recordTiming(activeLayerName, onTick, unit);
      // Record articulation for cross-layer contrast tracking
      ArticulationComplement.recordSustain(activeLayerName, texSustain, absMsAtOnTick);
      // Record texture mode for TexturalMirror
      TexturalMirror.recordTexture(activeLayerName, textureMode.mode || 'normal', absMsAtOnTick);
    }

    // Record note into AbsoluteTimeWindow for cross-layer analysis
    if (isPrimary && typeof AbsoluteTimeWindow !== 'undefined' && AbsoluteTimeWindow && typeof AbsoluteTimeWindow.recordNote === 'function') {
      const atwLayer = (typeof LM !== 'undefined' && LM && typeof LM.activeLayer === 'string') ? LM.activeLayer : 'L?';
      const absMs = absMsAtOnTick;
      const atwTime = absMs / 1000;
      AbsoluteTimeWindow.recordNote(noteToEmit, texVel, atwLayer, atwTime, unit);

      // Cross-layer interactions via AbsoluteTimeGrid
      ConvergenceDetector.postOnset(absMs, atwLayer, noteToEmit, texVel);
      const convergenceResult = ConvergenceDetector.applyIfConverged(absMs, atwLayer, noteToEmit, texVel);
      if (convergenceResult) {
        FeedbackOscillator.inject(absMs, atwLayer, clamp(convergenceResult.rarity, 0, 1), 'convergence', noteToEmit % 12);
      }
      VelocityInterference.postVelocity(absMs, atwLayer, texVel, VelocityInterference.measureDelta(atwLayer, atwTime));

      // #6 Spectral Complementarity: record note for histogram tracking
      SpectralComplementarity.recordNote(noteToEmit, atwLayer);

      // #8 Cross-Layer Motif Echo: record note for interval capture
      MotifEcho.recordNote(noteToEmit, atwLayer, absMs);
      MotifIdentityMemory.recordNote(atwLayer, noteToEmit, absMs);

      // Deliver pending motif echo as actual emitted notes
      const deliveredEcho = MotifEcho.deliverEcho(absMs, atwLayer, noteToEmit);
      if (deliveredEcho && Array.isArray(deliveredEcho.notes) && deliveredEcho.notes.length > 1) {
        const echoCount = m.min(3, deliveredEcho.notes.length - 1);
        for (let echoIndex = 0; echoIndex < echoCount; echoIndex++) {
          const echoNote = deliveredEcho.notes[echoIndex + 1];
          const echoStagger = tpUnit * rf(0.015, 0.06) * (echoIndex + 1);
          const echoVel = m.max(1, m.min(MIDI_MAX_VALUE, m.round(texVel * rf(0.65, 0.95))));
          const echoOnEvt = { tick: onTick + echoStagger, type: 'on', vals: [sourceCH, echoNote, echoVel] };
          const echoOffEvt = { tick: onTick + echoStagger + texSustain * rf(0.6, 0.95), vals: [sourceCH, echoNote] };
          microUnitAttenuator.record(echoOnEvt, echoOffEvt, crossModulation);
          scheduled += 2;
        }
      }

      // #10 Entropy Regulator: record sample for entropy measurement
      EntropyRegulator.recordSample(noteToEmit, texVel, atwLayer);

      // Record cross-layer interval for harmonic guard tracking
      const otherLayerForGuard = atwLayer === 'L1' ? 'L2' : 'L1';
      if (typeof AbsoluteTimeWindow !== 'undefined' && AbsoluteTimeWindow && typeof AbsoluteTimeWindow.getNotes === 'function') {
        const otherRecent = AbsoluteTimeWindow.getNotes({ layer: otherLayerForGuard, since: atwTime - 0.5, windowSeconds: 0.5 });
        if (otherRecent.length > 0) {
          const otherMidi = otherRecent[otherRecent.length - 1].midi || otherRecent[otherRecent.length - 1].note || 0;
          if (Number.isFinite(otherMidi) && otherMidi > 0) {
            HarmonicIntervalGuard.recordCrossInterval(noteToEmit, otherMidi, absMs);
          }
        }
      }

      // Pitch Memory Recall: memorize significant patterns via MotifIdentityMemory
      const memIdentity = (typeof MotifIdentityMemory !== 'undefined' && MotifIdentityMemory && typeof MotifIdentityMemory.getActiveIdentity === 'function')
        ? MotifIdentityMemory.getActiveIdentity(atwLayer) : null;
      if (memIdentity && typeof memIdentity.intervalDna === 'string' && memIdentity.intervalDna.length > 0) {
        const memIntervals = memIdentity.intervalDna.split(',').map(Number).filter(Number.isFinite);
        if (memIntervals.length >= 2) {
          const memConvergence = (typeof ConvergenceDetector !== 'undefined' && ConvergenceDetector && typeof ConvergenceDetector.wasRecent === 'function')
            ? ConvergenceDetector.wasRecent(absMs, atwLayer, 500) : false;
          PitchMemoryRecall.memorize(
            memIntervals,
            [noteToEmit % 12],
            { convergence: memConvergence, cadence: false, downbeat: false },
            typeof sectionIndex === 'number' ? sectionIndex : 0
          );
        }
      }
    }

    if (textureMode.mode === 'chordBurst' && isPrimary) {
      let burstIntervals = [3, 4, 7];
      if (typeof HarmonicContext !== 'undefined' && HarmonicContext && typeof HarmonicContext.getField === 'function') {
        const scalePCs = HarmonicContext.getField('scale');
        if (Array.isArray(scalePCs) && scalePCs.length > 1) {
          const rootPC = noteToEmit % 12;
          const derived = [];
          for (let scaleIndex = 0; scaleIndex < scalePCs.length; scaleIndex++) {
            const pc = typeof scalePCs[scaleIndex] === 'number' ? scalePCs[scaleIndex] % 12 : -1;
            if (pc < 0) continue;
            const interval = (pc - rootPC + 12) % 12;
            if (interval > 0) derived.push(interval);
          }
          if (derived.length >= 2) burstIntervals = derived;
        }
      }
      const burstCount = ri(2, 3);
      for (let burstIndex = 0; burstIndex < burstCount; burstIndex++) {
        const interval = burstIntervals[burstIndex % burstIntervals.length] * (rf() < 0.3 ? -1 : 1);
        const burstNote = modClamp(noteToEmit + interval, m.max(0, OCTAVE.min * 12 - 1), OCTAVE.max * 12 - 1);
        const burstVel = m.max(1, m.min(MIDI_MAX_VALUE, m.round(texVel * rf(0.8, 1.0))));
        const burstStagger = tpUnit * rf(0.002, 0.01) * (burstIndex + 1);
        const burstOnEvt = { tick: onTick + burstStagger, type: 'on', vals: [sourceCH, burstNote, burstVel] };
        const burstOffEvt = { tick: onTick + burstStagger + texSustain * rf(0.8, 1.1), vals: [sourceCH, burstNote] };
        microUnitAttenuator.record(burstOnEvt, burstOffEvt, crossModulation);
        scheduled += 2;
      }
    }

    if (textureMode.mode === 'flurry' && isPrimary) {
      const flurryCount = ri(3, 5);
      const flurryDir = rf() < 0.5 ? 1 : -1;
      let flurryNote = noteToEmit;
      const flurryGap = tpUnit * rf(0.04, 0.09);

      let scalePitches = null;
      if (typeof HarmonicContext !== 'undefined' && HarmonicContext && typeof HarmonicContext.getField === 'function') {
        const scalePCs = HarmonicContext.getField('scale');
        if (Array.isArray(scalePCs) && scalePCs.length > 1) {
          const lo = m.max(0, OCTAVE.min * 12 - 1);
          const hi = OCTAVE.max * 12 - 1;
          const pitches = [];
          for (let oct = m.floor(lo / 12); oct <= m.ceil(hi / 12); oct++) {
            for (let scaleIndex = 0; scaleIndex < scalePCs.length; scaleIndex++) {
              const pc = typeof scalePCs[scaleIndex] === 'number' ? scalePCs[scaleIndex] % 12 : -1;
              if (pc < 0) continue;
              const midi = oct * 12 + pc;
              if (midi >= lo && midi <= hi) pitches.push(midi);
            }
          }
          if (pitches.length > 2) scalePitches = pitches.sort((a, b) => a - b);
        }
      }

      for (let flurryIndex = 0; flurryIndex < flurryCount; flurryIndex++) {
        if (scalePitches) {
          let bestIdx = -1;
          let bestDist = Infinity;
          for (let scaleIndex = 0; scaleIndex < scalePitches.length; scaleIndex++) {
            const diff = (scalePitches[scaleIndex] - flurryNote) * flurryDir;
            if (diff > 0 && diff < bestDist) {
              bestDist = diff;
              bestIdx = scaleIndex;
            }
          }
          flurryNote = bestIdx >= 0
            ? scalePitches[bestIdx]
            : modClamp(flurryNote + flurryDir * ri(1, 2), m.max(0, OCTAVE.min * 12 - 1), OCTAVE.max * 12 - 1);
        } else {
          flurryNote = modClamp(flurryNote + flurryDir * ri(1, 2), m.max(0, OCTAVE.min * 12 - 1), OCTAVE.max * 12 - 1);
        }

        const flurryVel = m.max(1, m.min(MIDI_MAX_VALUE, m.round(texVel * rf(0.65, 0.95) * (1 - flurryIndex * 0.05))));
        const flurrySus = tpUnit * rf(0.08, 0.2) * textureMode.sustainScale;
        const flurryOnTick = onTick + flurryGap * (flurryIndex + 1);
        const flurryOnEvt = { tick: flurryOnTick, type: 'on', vals: [sourceCH, flurryNote, flurryVel] };
        const flurryOffEvt = { tick: flurryOnTick + flurrySus, vals: [sourceCH, flurryNote] };
        microUnitAttenuator.record(flurryOnEvt, flurryOffEvt, crossModulation);
        scheduled += 2;
      }
    }
  }

  const activeReflectionChannels = reflection.filter(ch => flipBin ? flipBinT.includes(ch) : flipBinF.includes(ch));
  for (let reflectionIndex = 0; reflectionIndex < activeReflectionChannels.length; reflectionIndex++) {
    const reflectionCH = activeReflectionChannels[reflectionIndex];
    const isPrimary = reflectionCH === cCH2;
    let onTick = isPrimary ? on + rv(tpUnit * rf(0.2), [-0.01, 0.1], 0.5) : on + rv(tpUnit * rf(1 / 3), [-0.01, 0.1], 0.5);
    onTick = GrooveTransfer.applyOffset(activeLayerName, onTick, unit);
    const reflectionPreSyncMs = tickToAbsMs(onTick);
    onTick = RhythmicPhaseLock.applyPhaseLock(reflectionPreSyncMs, activeLayerName, onTick).tick;
    onTick = TemporalGravity.applyGravity(reflectionPreSyncMs, activeLayerName, onTick);
    const baseOnVel = (isPrimary ? velocity * rf(0.7, 1.2) : binVel * rf(0.55, 1.1)) * pickVelScale;
    const reflectionVoiceId = voiceIdSeed + reflectionCH * 19 + pickIndex * 131 + reflectionIndex;
    const reflectionNoiseBase = baseOnVel * (1 - emissionCfg.reflectionNoiseInfluence * noiseInfluence);
    const { perProbScaled: perProbScaledRefl, onVel: onVelRefl } = getChannelCoherence(reflectionCH, 'reflection', reflectionNoiseBase, reflectionVoiceId, currentTime);

    const reflectSelected = (typeof Stutter !== 'undefined' && Stutter && Stutter.beatContext && Stutter.beatContext.selectedReflectionChannels && Stutter.beatContext.selectedReflectionChannels.has(reflectionCH));
    const reflectApplyShift = reflectSelected && selectedShift !== 0 && rf() < perProbScaledRefl;
    const reflectionEmitNoteBase = reflectApplyShift
      ? modClamp(pick.note + selectedShift, m.max(0, OCTAVE.min * 12 - 1), OCTAVE.max * 12 - 1)
      : pick.note;
    const reflectionEmitNote = RegisterCollisionAvoider.avoid(activeLayerName, reflectionEmitNoteBase, onTick).midi;

    const reflOnEvt = { tick: onTick, type: 'on', vals: [reflectionCH, reflectionEmitNote, onVelRefl] };
    const reflectionOffTick = on + sustain * (isPrimary ? rf(0.7, 1.2) : rv(rf(0.65, 1.3)));
    const reflOffEvt = { tick: reflectionOffTick, vals: [reflectionCH, reflectionEmitNote] };
    microUnitAttenuator.record(reflOnEvt, reflOffEvt, crossModulation);
    scheduled += 2;
    if (isPrimary) {
      RegisterCollisionAvoider.recordNote(activeLayerName, reflectionEmitNote, onTick);
      GrooveTransfer.recordTiming(activeLayerName, onTick, unit);
    }

    if (textureMode.mode === 'chordBurst' && isPrimary) {
      const reflBurstCount = ri(1, 2);
      const echoIntervals = [3, 4, 7];
      for (let burstIndex = 0; burstIndex < reflBurstCount; burstIndex++) {
        const echoInterval = echoIntervals[burstIndex % echoIntervals.length] * (rf() < 0.3 ? -1 : 1);
        const echoNote = modClamp(reflectionEmitNote + echoInterval, m.max(0, OCTAVE.min * 12 - 1), OCTAVE.max * 12 - 1);
        const echoVel = m.max(1, m.min(MIDI_MAX_VALUE, m.round(onVelRefl * rf(0.45, 0.65) * textureMode.velocityScale)));
        const echoStagger = tpUnit * rf(0.01, 0.04) * (burstIndex + 1);
        const echoOnEvt = { tick: onTick + echoStagger, type: 'on', vals: [reflectionCH, echoNote, echoVel] };
        const echoOffEvt = { tick: onTick + echoStagger + sustain * textureMode.sustainScale * rf(0.6, 0.9), vals: [reflectionCH, echoNote] };
        microUnitAttenuator.record(echoOnEvt, echoOffEvt, crossModulation);
        scheduled += 2;
      }
    }

    if (textureMode.mode === 'flurry' && isPrimary) {
      const ghostDir = rf() < 0.5 ? 1 : -1;
      const ghostNote = modClamp(reflectionEmitNote + ghostDir * ri(1, 3), m.max(0, OCTAVE.min * 12 - 1), OCTAVE.max * 12 - 1);
      const ghostVel = m.max(1, m.min(MIDI_MAX_VALUE, m.round(onVelRefl * rf(0.35, 0.55))));
      const ghostDelay = tpUnit * rf(0.06, 0.14);
      const ghostSus = tpUnit * rf(0.1, 0.25) * textureMode.sustainScale;
      const ghostOnEvt = { tick: onTick + ghostDelay, type: 'on', vals: [reflectionCH, ghostNote, ghostVel] };
      const ghostOffEvt = { tick: onTick + ghostDelay + ghostSus, vals: [reflectionCH, ghostNote] };
      microUnitAttenuator.record(ghostOnEvt, ghostOffEvt, crossModulation);
      scheduled += 2;
    }
  }

  if (rf() < clamp(0.75 * bpmRatio3, 0.2, 0.7)) {
    const activeBassChannels = bass.filter(ch => flipBin ? flipBinT.includes(ch) : flipBinF.includes(ch));
    for (let bassIndex = 0; bassIndex < activeBassChannels.length; bassIndex++) {
      const bassCH = activeBassChannels[bassIndex];
      const isPrimary = bassCH === cCH3;
      let onTick = isPrimary ? on + rv(tpUnit * rf(0.1), [-0.01, 0.1], 0.5) : on + rv(tpUnit * rf(1 / 3), [-0.01, 0.1], 0.5);
      onTick = GrooveTransfer.applyOffset(activeLayerName, onTick, unit);
      const bassPreSyncMs = tickToAbsMs(onTick);
      onTick = RhythmicPhaseLock.applyPhaseLock(bassPreSyncMs, activeLayerName, onTick).tick;
      onTick = TemporalGravity.applyGravity(bassPreSyncMs, activeLayerName, onTick);
      const onVelRaw = (isPrimary ? velocity * rf(1.15, 1.5) : binVel * rf(1.85, 2.5)) * pickVelScale;
      const bassVoiceId = voiceIdSeed + bassCH * 23 + pickIndex * 151 + bassIndex;
      const bassNoiseBase = onVelRaw * (1 - emissionCfg.bassNoiseInfluence * noiseInfluence);
      const { perProbScaled: perProbScaledBass, onVel } = getChannelCoherence(bassCH, 'bass', bassNoiseBase, bassVoiceId, currentTime);

      const bassSelected = (typeof Stutter !== 'undefined' && Stutter && Stutter.beatContext && Stutter.beatContext.selectedBassChannels && Stutter.beatContext.selectedBassChannels.has(bassCH));
      const bassApplyShift = bassSelected && selectedShift !== 0 && rf() < perProbScaledBass;
      const bassEmitBase = bassApplyShift ? pick.note + selectedShift : pick.note;
      const bassNoteBase = modClamp(bassEmitBase, m.max(0, OCTAVE.min * 12 - 1), 59);
      const bassNote = RegisterCollisionAvoider.avoid(activeLayerName, bassNoteBase, onTick).midi;

      const bassOnEvt = { tick: onTick, type: 'on', vals: [bassCH, bassNote, onVel] };
      const bassSustainScale = textureMode.mode === 'chordBurst' ? textureMode.sustainScale * rf(1.2, 1.6)
        : textureMode.mode === 'flurry' ? rf(1.3, 1.8)
        : 1;
      const bassOffTick = on + sustain * bassSustainScale * (isPrimary ? rf(1.1, 3) : rv(rf(0.8, 3.5)));
      const bassOffEvt = { tick: bassOffTick, vals: [bassCH, bassNote] };
      microUnitAttenuator.record(bassOnEvt, bassOffEvt, crossModulation);
      scheduled += 2;
      if (isPrimary) {
        RegisterCollisionAvoider.recordNote(activeLayerName, bassNote, onTick);
        GrooveTransfer.recordTiming(activeLayerName, onTick, unit);
      }
    }
  }

  return scheduled;
};
