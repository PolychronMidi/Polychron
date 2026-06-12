// setMeter.js - Validate meter, compute meterRatio, emit meter MIDI event.
// Single responsibility: meter changes. Split from midiTiming.js for SRP (R43).
// Freezes meter snapshot after computation (R44 -- fail fast on mutation).

/** @type {{ numerator: number, denominator: number, meterRatio: number } | null} */
let lastMeterSnapshot = null;

setMeter = () => {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    throw new Error('setMeter: invalid meter ' + numerator + '/' + denominator);
  }
  meterRatio = numerator / denominator;
  p(c, { timeInSeconds: measureStartTime, type: 'meter', vals: [numerator, denominator] });
  lastMeterSnapshot = deepFreeze({ numerator, denominator, meterRatio });
};

/** @returns {{ numerator: number, denominator: number, meterRatio: number } | null} */
setMeter.getSnapshot = () => lastMeterSnapshot;
