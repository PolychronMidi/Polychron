// emitPickCrossLayerRecord.js - Record primary source note into cross-layer tracking systems.
// Extracted from playNotesEmitPick to keep the emission orchestrator focused.

const V = validator.create('emitPickCrossLayerRecord');

function _getMotifEchoLimitConfig() {
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
    softEchoCount: analysis && Number.isFinite(analysis.motifEchoSoftCount) ? m.max(0, m.round(analysis.motifEchoSoftCount)) : 2,
    hardEchoCount: analysis && Number.isFinite(analysis.motifEchoHardCount) ? m.max(0, m.round(analysis.motifEchoHardCount)) : 1
  };
}

/**
 * Record a primary source note emission into all cross-layer tracking systems.
 * Delivers pending motif echoes as additional emitted notes.
 * @param {Object} ctx - emission context from the source channel loop
 * @returns {number} additional scheduled event count from echo delivery
 */
emitPickCrossLayerRecord = function(ctx) {
  V.assertPlainObject(ctx, 'ctx');
  const { noteToEmit, texVel, activeLayerName, absMsAtOnTick, unit, onTick, sourceCH, tpUnit, texSustain, harmonicOtherMidi } = ctx;

  const absMs = absMsAtOnTick;
  const atwTime = absMs / 1000;
  absoluteTimeWindow.recordNote(noteToEmit, texVel, activeLayerName, atwTime, unit);

  // Cross-layer interactions
  convergenceDetector.postOnset(absMs, activeLayerName, noteToEmit, texVel);
  const convergenceResult = convergenceDetector.applyIfConverged(absMs, activeLayerName, noteToEmit, texVel);
  if (convergenceResult) {
    feedbackOscillator.inject(absMs, activeLayerName, clamp(convergenceResult.rarity, 0, 1), 'convergence', noteToEmit % 12);
  }
  velocityInterference.postVelocity(absMs, activeLayerName, texVel, velocityInterference.measureDelta(activeLayerName, atwTime));

  // Spectral Complementarity: record note for histogram tracking
  spectralComplementarity.recordNote(noteToEmit, activeLayerName);

  // Cross-Layer Motif Echo: record note for interval capture
  motifEcho.recordNote(noteToEmit, activeLayerName, absMs);
  motifIdentityMemory.recordNote(activeLayerName, noteToEmit, absMs);

  // Deliver pending motif echo as actual emitted notes
  let additionalScheduled = 0;
  const deliveredEcho = motifEcho.deliverEcho(absMs, activeLayerName, noteToEmit);
  if (deliveredEcho && Array.isArray(deliveredEcho.notes) && deliveredEcho.notes.length > 1) {
    const echoConfig = _getMotifEchoLimitConfig();
    const recentPrimaryNoteCount = absoluteTimeWindow.countNotes({ layer: activeLayerName, windowSeconds: echoConfig.windowSeconds });
    const recentPrimaryNotesPerSecond = echoConfig.windowSeconds > 0
      ? recentPrimaryNoteCount / echoConfig.windowSeconds
      : recentPrimaryNoteCount;
    let echoCountCap = 3;
    if (recentPrimaryNotesPerSecond >= echoConfig.hardNotesPerSecond) {
      echoCountCap = echoConfig.hardEchoCount;
    } else if (recentPrimaryNotesPerSecond >= echoConfig.softNotesPerSecond) {
      echoCountCap = echoConfig.softEchoCount;
    }
    const echoCount = m.min(echoCountCap, deliveredEcho.notes.length - 1);
    for (let echoIndex = 0; echoIndex < echoCount; echoIndex++) {
      const echoNote = deliveredEcho.notes[echoIndex + 1];
      const echoStagger = tpUnit * rf(0.015, 0.06) * (echoIndex + 1);
      const echoVel = m.max(1, m.min(MIDI_MAX_VALUE, m.round(texVel * rf(0.65, 0.95))));
      const echoOnEvt = { tick: onTick + echoStagger, type: 'on', vals: [sourceCH, echoNote, echoVel] };
      const echoOffEvt = { tick: onTick + echoStagger + texSustain * rf(0.6, 0.95), vals: [sourceCH, echoNote] };
      microUnitAttenuator.record(echoOnEvt, echoOffEvt, crossModulation);
      additionalScheduled += 2;
    }
  }

  // Entropy Regulator: record sample for entropy measurement
  entropyRegulator.recordSample(noteToEmit, texVel, activeLayerName);

  // Record cross-layer interval for harmonic guard tracking.
  // Use pre-computed otherMidi from harmonicIntervalGuard.nudgePitch() when available,
  // avoiding a redundant absoluteTimeWindow.getLastNote() query.
  if (Number.isFinite(harmonicOtherMidi) && harmonicOtherMidi > 0) {
    harmonicIntervalGuard.recordCrossInterval(noteToEmit, harmonicOtherMidi, absMs);
  } else if (harmonicOtherMidi === -1) {
    // harmonicOtherMidi === -1 means nudgePitch found no other-layer note; skip query entirely
  } else {
    // Fallback: query ATW directly (should not normally occur)
    const otherLayerForGuard = activeLayerName === 'L1' ? 'L2' : 'L1';
    const otherRecentEntry = absoluteTimeWindow.getLastNote({ layer: otherLayerForGuard, since: atwTime - 0.5, windowSeconds: 0.5 });
    if (otherRecentEntry) {
      const otherMidiCandidate = Number(
        (Number.isFinite(Number(otherRecentEntry.midi)))
          ? otherRecentEntry.midi
          : (otherRecentEntry.note || NaN)
      );
      V.requireFinite(otherMidiCandidate, 'otherMidiCandidate');
      if (otherMidiCandidate > 0) {
        harmonicIntervalGuard.recordCrossInterval(noteToEmit, otherMidiCandidate, absMs);
      }
    }
  }

  // Pitch Memory Recall: memorize significant patterns via motifIdentityMemory
  const memIdentity = motifIdentityMemory.getActiveIdentity(activeLayerName);
  if (memIdentity && typeof memIdentity.intervalDna === 'string' && memIdentity.intervalDna.length > 0) {
    // Cache parsed intervals on the identity object to avoid split/map/filter per pick
    /** @type {any} */ const memI = memIdentity;
    let memIntervals = memI._parsedIntervals;
    if (memIntervals === undefined) {
      const parts = memIdentity.intervalDna.split(',');
      memIntervals = [];
      for (let pi = 0; pi < parts.length; pi++) {
        const n = Number(parts[pi]);
        if (Number.isFinite(n)) memIntervals.push(n);
      }
      memI._parsedIntervals = memIntervals;
    }
    if (memIntervals.length >= 2) {
      const memConvergence = convergenceDetector.wasRecent(absMs, activeLayerName, 500);
      pitchMemoryRecall.memorize(
        memIntervals,
        [noteToEmit % 12],
        { convergence: memConvergence, cadence: false, downbeat: false },
        sectionIndex
      );
    }
  }

  return additionalScheduled;
};
