// emitPickCrossLayerRecord.js — Record primary source note into cross-layer tracking systems.
// Extracted from playNotesEmitPick to keep the emission orchestrator focused.

const V = Validator.create('emitPickCrossLayerRecord');

/**
 * Record a primary source note emission into all cross-layer tracking systems.
 * Delivers pending motif echoes as additional emitted notes.
 * @param {Object} ctx - emission context from the source channel loop
 * @returns {number} additional scheduled event count from echo delivery
 */
emitPickCrossLayerRecord = function(ctx) {
  V.assertPlainObject(ctx, 'ctx');
  const { noteToEmit, texVel, activeLayerName, absMsAtOnTick, unit, onTick, sourceCH, tpUnit, texSustain } = ctx;

  const absMs = absMsAtOnTick;
  const atwTime = absMs / 1000;
  AbsoluteTimeWindow.recordNote(noteToEmit, texVel, activeLayerName, atwTime, unit);

  // Cross-layer interactions
  ConvergenceDetector.postOnset(absMs, activeLayerName, noteToEmit, texVel);
  const convergenceResult = ConvergenceDetector.applyIfConverged(absMs, activeLayerName, noteToEmit, texVel);
  if (convergenceResult) {
    FeedbackOscillator.inject(absMs, activeLayerName, clamp(convergenceResult.rarity, 0, 1), 'convergence', noteToEmit % 12);
  }
  VelocityInterference.postVelocity(absMs, activeLayerName, texVel, VelocityInterference.measureDelta(activeLayerName, atwTime));

  // Spectral Complementarity: record note for histogram tracking
  SpectralComplementarity.recordNote(noteToEmit, activeLayerName);

  // Cross-Layer Motif Echo: record note for interval capture
  MotifEcho.recordNote(noteToEmit, activeLayerName, absMs);
  MotifIdentityMemory.recordNote(activeLayerName, noteToEmit, absMs);

  // Deliver pending motif echo as actual emitted notes
  let additionalScheduled = 0;
  const deliveredEcho = MotifEcho.deliverEcho(absMs, activeLayerName, noteToEmit);
  if (deliveredEcho && Array.isArray(deliveredEcho.notes) && deliveredEcho.notes.length > 1) {
    const echoCount = m.min(3, deliveredEcho.notes.length - 1);
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
  EntropyRegulator.recordSample(noteToEmit, texVel, activeLayerName);

  // Record cross-layer interval for harmonic guard tracking
  const otherLayerForGuard = activeLayerName === 'L1' ? 'L2' : 'L1';
  const otherRecentEntry = AbsoluteTimeWindow.getLastNote({ layer: otherLayerForGuard, since: atwTime - 0.5, windowSeconds: 0.5 });
  if (otherRecentEntry) {
    const otherMidiCandidate = Number(
      (Number.isFinite(Number(otherRecentEntry.midi)))
        ? otherRecentEntry.midi
        : (otherRecentEntry.note || NaN)
    );
    if (!Number.isFinite(otherMidiCandidate)) {
      throw new Error(`${unit}.emitPickCrossLayerRecord: other layer note history entry must include finite midi or note`);
    }
    if (otherMidiCandidate > 0) {
      HarmonicIntervalGuard.recordCrossInterval(noteToEmit, otherMidiCandidate, absMs);
    }
  }

  // Pitch Memory Recall: memorize significant patterns via MotifIdentityMemory
  const memIdentity = MotifIdentityMemory.getActiveIdentity(activeLayerName);
  if (memIdentity && typeof memIdentity.intervalDna === 'string' && memIdentity.intervalDna.length > 0) {
    // Cache parsed intervals on the identity object to avoid split/map/filter per pick
    let memIntervals = memIdentity._parsedIntervals;
    if (memIntervals === undefined) {
      const parts = memIdentity.intervalDna.split(',');
      memIntervals = [];
      for (let pi = 0; pi < parts.length; pi++) {
        const n = Number(parts[pi]);
        if (Number.isFinite(n)) memIntervals.push(n);
      }
      memIdentity._parsedIntervals = memIntervals;
    }
    if (memIntervals.length >= 2) {
      const memConvergence = ConvergenceDetector.wasRecent(absMs, activeLayerName, 500);
      PitchMemoryRecall.memorize(
        memIntervals,
        [noteToEmit % 12],
        { convergence: memConvergence, cadence: false, downbeat: false },
        sectionIndex
      );
    }
  }

  return additionalScheduled;
};
