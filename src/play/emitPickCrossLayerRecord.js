// emitPickCrossLayerRecord.js - Record primary source note into cross-layer tracking systems.
// Extracted from playNotesEmitPick to keep the emission orchestrator focused.

const V = validator.create('emitPickCrossLayerRecord');
const EMIT_PICK_CROSS_LAYER_PROFILE = process.argv.includes('--trace');

/**
 * Record a primary source note emission into all cross-layer tracking systems.
 * Delivers pending motif echoes as additional emitted notes.
 * @param {Object} ctx - emission context from the source channel loop
 * @returns {number} additional scheduled event count from echo delivery
 */
emitPickCrossLayerRecord = function(ctx) {
  const emitPickCrossLayerStartedAt = EMIT_PICK_CROSS_LAYER_PROFILE ? process.hrtime.bigint() : 0n;
  V.assertPlainObject(ctx, 'ctx');
  const { noteToEmit, texVel, activeLayerName, absMsAtOnTime, unit, onTime, sourceCH, spUnit, texSustain, harmonicOtherMidi } = ctx;

  const absMs = absMsAtOnTime;
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
    for (let echoIndex = 1; echoIndex < deliveredEcho.notes.length; echoIndex++) {
      const echoNote = deliveredEcho.notes[echoIndex];
      const echoStep = echoIndex;
      const echoStagger = spUnit * rf(0.015, 0.06) * echoStep;
      const echoVel = m.max(1, m.min(MIDI_MAX_VALUE, m.round(texVel * rf(0.65, 0.95))));
      const echoOnTime = onTime + echoStagger;
      const echoOffTime = minimumNoteDuration.resolveOffTick(
        echoOnTime,
        echoOnTime + texSustain * rf(0.6, 0.95),
        'ornament',
        spUnit,
        'emitPickCrossLayerRecord.echoOffTime'
      );
      const echoOnEvt = { timeInSeconds: echoOnTime, type: 'on', vals: [sourceCH, echoNote, echoVel] };
      const echoOffEvt = { timeInSeconds: echoOffTime, vals: [sourceCH, echoNote] };
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
    let memIntervals = memI.emitPickCrossLayerRecordParsedIntervals;
    if (memIntervals === undefined) {
      const parts = memIdentity.intervalDna.split(',');
      memIntervals = [];
      for (let pi = 0; pi < parts.length; pi++) {
        const n = Number(parts[pi]);
        if (Number.isFinite(n)) memIntervals.push(n);
      }
      memI.emitPickCrossLayerRecordParsedIntervals = memIntervals;
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

  if (EMIT_PICK_CROSS_LAYER_PROFILE) traceDrain.recordRuntimeMetric(`emitPickCrossLayerRecord.${unit}`, Number(process.hrtime.bigint() - emitPickCrossLayerStartedAt) / 1e6);
  return additionalScheduled;
};
