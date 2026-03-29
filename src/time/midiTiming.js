/**
 * Compute MIDI-compatible meter and tempo sync factor.
 * Sets: midiMeter, midiMeterRatio, syncFactor, midiBPM, spMeasure.
 * @returns {number[]} MIDI meter as [numerator, denominator].
 */
getMidiTiming = () => {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    throw new Error(`Invalid meter: ${numerator}/${denominator}`);
  }
  if (!Number.isFinite(BPM) || BPM <= 0) {
    throw new Error(`Invalid BPM: ${BPM}`);
  }
  meterRatio = numerator / denominator;

  return setMidiTiming();
};

/**
 * Writes MIDI timing events to active buffer (c).
 * Context-aware: writes to c1 or c2 depending on current meter.
 */
setMidiTiming = () => {
  const effectiveBpm = BPM * (Number.isFinite(sectionBpmScale) ? sectionBpmScale : 1.0);
  spMeasure = (60 / effectiveBpm) * 4 * meterRatio;
  if (!Number.isFinite(spMeasure) || spMeasure <= 0) {
    throw new Error(`Invalid spMeasure: ${spMeasure}`);
  }
  p(c,
    { timeInSeconds: measureStartTime, type: 'bpm', vals: [effectiveBpm] },
    { timeInSeconds: measureStartTime, type: 'meter', vals: [numerator, denominator] },
  );
  L0.post('tickDuration', LM.activeLayer || 'shared', measureStartTime, { oneTickInSeconds: 60 / (effectiveBpm * PPQ), effectiveBpm, bpmScale: sectionBpmScale });
};
