// Force duplicate capture by seeding an identical unit and invoking setUnitTiming
// Usage: STRICT_DUP_CAPTURE=1 node scripts/dup-force-capture.js

// Minimal global setup
TUNING_FREQ = 440; BINAURAL = { min: 0.1, max: 1.0 };
require('../src/writer.js');
require('../src/time.js');
require('../src/rhythm.js');

// Reset LM
if (LM) { LM.layers = {}; LM.activeLayer = null; }
const { state: primary } = LM.register('primary', 'c1', {}, () => {});

// Shims: avoid ReferenceErrors for keys / helpers referenced inside setUnitTiming when running in isolation
beatKey = (typeof beatKey !== 'undefined') ? beatKey : 'beat:0:0';
divKey = (typeof divKey !== 'undefined') ? divKey : 'div:0:0:0';
// Ensure logUnit exists globally (writer normally provides it during full runtime)
if (typeof logUnit === 'undefined') logUnit = (/*type*/) => {};

// Deterministic timing & composer
sectionIndex = 0; phraseIndex = 0; measureIndex = 0; beatIndex = 0;
tpSec = 1000; tpMeasure = 1000; spMeasure = 1; phraseStart = 0; phraseStartTime = 0;
numerator = 4; denominator = 4; measuresPerPhrase = 1;
composer = { getDivisions: () => 1, getSubdivs: () => 7, getSubsubdivs: () => 4, getMeter: () => [4,4] };
BPM = 120; PPQ = 480; getMidiTiming();
LM.activate('primary', false);

divIndex = 0; subdivIndex = 0; subsubdivIndex = 0; // explicit totals to avoid composer cache lookups
divsPerBeat = 1; subdivsPerDiv = 7; subsubsPerSub = 4;

// First call to compute a canonical unitRec and persist it
try {
  setUnitTiming('subsubdiv');
} catch (e) {
  console.error('First setUnitTiming threw unexpectedly:', e && e.stack ? e.stack : e);
  process.exit(1);
}

// Grab last unit and clone push it to seed a duplicate
const units = LM.layers['primary'].state.units;
const last = units && units.length ? units[units.length - 1] : null;
if (!last) { console.error('No unit found to clone - aborting'); process.exit(1); }
// Clone and push an identical record to simulate a prior emit for the same canonical indices and ticks
const clone = Object.assign({}, last);
units.push(clone);
console.log('Seeded duplicate unit - now invoking setUnitTiming again with STRICT_DUP_CAPTURE=1 to force capture');
console.log('Last two units (start/end/indices):', units.slice(-2).map(u => ({ start: u.startTick, end: u.endTick, section: u.sectionIndex, phrase: u.phraseIndex, measure: u.measureIndex })));

try {
  setUnitTiming('subsubdiv');
  console.log('setUnitTiming completed without throwing (unexpected)');
  console.log('After call, last two units:', LM.layers['primary'].state.units.slice(-2).map(u => ({ start: u.startTick, end: u.endTick, section: u.sectionIndex, phrase: u.phraseIndex, measure: u.measureIndex })));
} catch (e) {
  console.error('setUnitTiming threw as expected:', e && e.stack ? e.stack : e);
  // exit non-zero so CI/test run sees the capture
  process.exit(1);
}
