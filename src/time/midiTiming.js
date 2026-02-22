/** @param {number} n @returns {boolean} */
isPowerOf2 = (n) => (n & (n - 1)) === 0;

/**
 * Compute MIDI-compatible meter and tempo sync factor.
 * Sets: midiMeter, midiMeterRatio, syncFactor, midiBPM, tpSec, tpMeasure, spMeasure.
 * @returns {number[]} MIDI meter as [numerator, denominator].
 */
getMidiTiming = (tick=measureStart) => {
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

  return setMidiTiming(tick);
};

/**
 * Writes MIDI timing events to active buffer (c).
 * Context-aware: writes to c1 or c2 depending on current meter.
 * @param {number} [tick] - MIDI tick position.
 */
setMidiTiming = (tick=measureStart) => {
  midiMeterRatio = midiMeter[0] / midiMeter[1];
  syncFactor = midiMeterRatio / meterRatio;
  midiBPM = BPM * syncFactor;
  tpSec = midiBPM * PPQ / 60;
  tpMeasure = PPQ * 4 * midiMeterRatio;
  spMeasure = (60 / BPM) * 4 * meterRatio;
  if (!Number.isFinite(tpSec) || tpSec <= 0) {
    throw new Error(`Invalid tpSec: ${tpSec}`);
  }
  p(c,
    { tick: tick, type: 'bpm', vals: [midiBPM] },
    { tick: tick, type: 'meter', vals: [midiMeter[0], midiMeter[1]] },
  );
};
