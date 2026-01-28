// Quick reproducer to force duplicate emissions by repeatedly calling setUnitTiming
// Minimal required globals for writer/backstage initialization
TUNING_FREQ = 440; BINAURAL = { min: 0.1, max: 1.0 };
require('../src/writer.js');
require('../src/time.js');
require('../src/rhythm.js');
const fs = require('fs');
const path = require('path');

// reset LM
if (LM) { LM.layers = {}; LM.activeLayer = null; }

// register layer
const { state: primary } = LM.register('primary', 'c1', {}, () => {});

// set deterministic globals (copied from integration test)
sectionIndex = 0; phraseIndex = 0; measureIndex = 0; beatIndex = 0;
tpSec = 1000; tpMeasure = 1000; spMeasure = 1; phraseStart = 0; phraseStartTime = 0;
numerator = 4; denominator = 4; measuresPerPhrase = 1;
beatRhythm = [1,1,1,1]; divRhythm = [1]; subdivRhythm = [1]; subsubdivRhythm = [1];
randomWeightedSelection = (obj) => Object.keys(obj)[0];

m = Math;
ri = (...args) => { if (args.length === 1) return Math.floor(args[0]) || 0; if (args.length === 2) return args[0]; return args[0]; };
rf = (a,b) => (typeof b === 'undefined' ? (a || 0.5) : a);
rv = (a,b,c) => a; ra = (v) => { if (typeof v === 'function') return v(); if (Array.isArray(v)) return v[0]; return v; };
composer = { getDivisions: () => 1, getSubdivs: () => 7, getSubsubdivs: () => 4, getMeter: () => [4,4] };
BPM = 120; PPQ = 480; getMidiTiming();
measuresPerPhrase1 = 1; measuresPerPhrase2 = 1; LM.activate('primary', false);

// ensure internal counters
beatsOn = 0; beatsOff = 0; divsOn = 0; divsOff = 0; subdivsOn = 0; subdivsOff = 0;
__POLYCHRON_TEST__ = __POLYCHRON_TEST__ || {}; __POLYCHRON_TEST__.enableLogging = false;
divIndex = 0; subdivIndex = 0; subsubdivIndex = 0; subdivsPerDiv = 7; subsubsPerSub = 4;

console.log('Calling setUnitTiming multiple times to force duplicate');
for (let i = 0; i < 10; i++) {
  try { setUnitTiming('subsubdiv'); } catch (e) { console.error('Error in setUnitTiming', e && e.stack ? e.stack : e); break; }
}
console.log('Done, units length:', LM.layers['primary'].state.units.length);
console.log(LM.layers['primary'].state.units.slice(-10));
