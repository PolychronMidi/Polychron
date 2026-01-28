#!/usr/bin/env node
require('../src/sheet');
require('../src/writer');
require('../src/backstage');
require('../src/time');

// Simulate beforeEach from test
numerator = 4; denominator = 4; BPM = 120; PPQ = 480; sectionStart = 0; phraseStart = 0; measureStart = 0; phraseStartTime = 0; measureStartTime = 0;
tpMeasure = 480 * 4; tpSec = 480 * 4; tpPhrase = tpMeasure * 4; measuresPerPhrase = 4;
LM = { layers: { primary: { state: { units: [] }, buffer: [] } }, activeLayer: 'primary' };
composer = composer || { getDivisions: () => 2, getSubdivs: () => 2, getSubsubdivs: () => 1, constructor: { name: 'TestComposer' } };

// Test-specific overrides
tpMeasure = 4800; tpSubdiv = 2400; subsubsPerSub = 1; subsubdivIndex = 0; subdivStart = 0; subdivStartTime = 0;

// Provide no-op helpers used inside setUnitTiming
trackBeatRhythm = () => {};
trackDivRhythm = () => {};
trackSubsubdivRhythm = () => {};
logUnit = () => {};
setRhythm = () => 0;

try {
  setUnitTiming('subsubdiv');
  console.log('setUnitTiming returned without throwing');
} catch (e) {
  console.error('setUnitTiming threw:', e && e.stack ? e.stack : e);
}

const computedTpSubsub = (Number.isFinite(tpSubsubdiv) && tpSubsubdiv > 0) ? tpSubsubdiv : ((Number.isFinite(tpSubdiv) && Number.isFinite(subsubsPerSub)) ? (tpSubdiv / Math.max(1, subsubsPerSub)) : NaN);
const sCandidate = Number(subdivStart || 0) + (Number.isFinite(Number(subsubdivIndex)) ? Number(subsubdivIndex) : 0) * computedTpSubsub;
const eCandidate = sCandidate + computedTpSubsub;
console.log('computed:', { computedTpSubsub, sCandidate, eCandidate, diff: (eCandidate - sCandidate), cond1: ((eCandidate - sCandidate) >= Math.round(tpSubdiv)), cond2: (Number(tpSubdiv) >= (Math.max(1, Math.round(tpMeasure)) / 2)) });
