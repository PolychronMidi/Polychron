/** @param {number} n @returns {boolean} */
isPowerOf2 = (n) => (n & (n - 1)) === 0;

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

  if (isPowerOf2(denominator)) {
    midiMeter = [numerator, denominator];
  } else {
    const high = 2 ** m.ceil(m.log2(denominator));
    const highRatio = numerator / high;
    const low = 2 ** m.floor(m.log2(denominator));
    const lowRatio = numerator / low;
    midiMeter = m.abs(meterRatio - highRatio) < m.abs(meterRatio - lowRatio)
      ? [numerator, high]
      : [numerator, low];
  }

  return setMidiTiming();
};

/**
 * Writes MIDI timing events to active buffer (c).
 * Context-aware: writes to c1 or c2 depending on current meter.
 */
setMidiTiming = () => {
  midiMeterRatio = midiMeter[0] / midiMeter[1];
  syncFactor = midiMeterRatio / meterRatio;
  midiBPM = BPM * syncFactor;
  spMeasure = (60 / BPM) * 4 * meterRatio;
  if (!Number.isFinite(spMeasure) || spMeasure <= 0) {
    throw new Error(`Invalid spMeasure: ${spMeasure}`);
  }
  p(c,
    { timeInSeconds: measureStartTime, type: 'bpm', vals: [midiBPM] },
    { timeInSeconds: measureStartTime, type: 'meter', vals: [midiMeter[0], midiMeter[1]] },
  );
};
