#!/usr/bin/env node
require('../src/sheet');
require('../src/backstage');
require('../src/time');

// Repro scenario from test
numerator = 4; denominator = 4; BPM = 120; PPQ = 480; tpSec = 480 * 4; tpMeasure = 4800; tpSubdiv = 2400; subsubsPerSub = 1; subsubdivIndex = 0; subdivStart = 0; subdivStartTime = 0;
// Provide no-op rhythm helpers used by setUnitTiming
trackBeatRhythm = () => {};
trackDivRhythm = () => {};
trackSubsubdivRhythm = () => {};

try {
  setUnitTiming('subsubdiv');
  console.log('setUnitTiming returned without throwing');
} catch (e) {
  console.error('setUnitTiming threw:', e && e.stack ? e.stack : e);
}

console.log('globals:', { tpMeasure, tpSubdiv, tpSubsubdiv, subsubsPerSub, subdivStart, subsubdivIndex });
