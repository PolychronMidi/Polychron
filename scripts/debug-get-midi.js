// quick debug runner
require('../src/test-setup.js');
// ensure globals
try { numerator = 7; denominator = 9; BPM = 120; PPQ = 480; } catch (e) { console.error('assign error', e); }
const t = require('../src/time');
try {
  const res = getMidiTiming();
  console.log('getMidiTiming returned', res);
  console.log({ midiMeter, midiMeterRatio, meterRatio, syncFactor, midiBPM, tpSec, tpMeasure, spMeasure });
} catch (e) {
  console.error('ERROR calling getMidiTiming:', e && e.stack ? e.stack : e);
}
