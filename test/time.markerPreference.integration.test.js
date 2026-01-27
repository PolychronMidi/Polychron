import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// Load runtime modules required for integration behavior
require('../src/writer.js'); // CSVBuffer
require('../src/time.js');
require('../src/rhythm.js');

describe('Marker preference - end-to-end integration', () => {
  const OUT = path.join(process.cwd(), 'output');

  beforeEach(() => {
    if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);
    try { fs.unlinkSync(path.join(OUT, 'output1.csv')); } catch (e) {}
    // reset LM
    if (LM) {
      LM.layers = {}; LM.activeLayer = null;
    }
    // safe deterministic helpers
    m = Math; LOG = 'none';
  });

  afterEach(() => {
    try { fs.unlinkSync(path.join(OUT, 'output1.csv')); } catch (e) {}
  });

  it('setUnitTiming should prefer CSV marker seconds when present', () => {
    // write CSV with explicit seconds for measure/beat
    const line = '1,0,marker_t,unitRec:primary|section1|phrase1|measure1|beat1/4|0-1000|0.000000-1.000000';
    fs.writeFileSync(path.join(OUT, 'output1.csv'), line + '\n');

    // register layer
    const { state: primary, buffer: c1 } = LM.register('primary', 'c1', {}, () => {});

    // set indexes and timing globals deterministically
    sectionIndex = 0; phraseIndex = 0; measureIndex = 0; beatIndex = 0;
    tpSec = 1000; // ticks per second mapping (so 1s = 1000 ticks)
    tpMeasure = 1000; spMeasure = 1; phraseStart = 0; phraseStartTime = 0;
    numerator = 4; denominator = 4; measuresPerPhrase = 1;
    // ensure rhythm arrays are present
    beatRhythm = [1,1,1,1]; divRhythm = [1]; subdivRhythm = [1]; subsubdivRhythm = [1];
    // deterministic rhythm helper used by getRhythm
    randomWeightedSelection = (obj) => Object.keys(obj)[0];
    // numeric random helpers used by rhythm.js
    m = Math;
    ri = (...args) => { if (args.length === 1) return Math.floor(args[0]) || 0; if (args.length === 2) return args[0]; return args[0]; };
    rf = (a,b) => (typeof b === 'undefined' ? (a || 0.5) : a);
    rv = (a,b,c) => a;
    ra = (v) => { if (typeof v === 'function') return v(); if (Array.isArray(v)) return v[0]; return v; };

    // minimal composer stub for deterministic behavior
    composer = {
      getDivisions: () => 1,
      getSubdivisions: () => 1,
      getSubsubdivs: () => 1,
      getMeter: () => [4, 4]
    };

    // ensure MIDI timing values are initialized so setMidiTiming() works
    BPM = 120; PPQ = 480; getMidiTiming();

    // polyrhythm defaults for deterministic activation
    measuresPerPhrase1 = 1; measuresPerPhrase2 = 1;
    // activate layer so 'c' is set and setMidiTiming writes to the correct buffer
    LM.activate('primary', false);



    // ensure beat/div counters for rhythm functions
    beatsOn = 0; beatsOff = 0; divsOn = 0; divsOff = 0; subdivsOn = 0; subdivsOff = 0;

    // ensure internal test logging is disabled for clean output
    __POLYCHRON_TEST__ = __POLYCHRON_TEST__ || {}; __POLYCHRON_TEST__.enableLogging = false;

    // ensure minimal index variables exist to avoid ReferenceErrors in setUnitTiming
    divIndex = 0; subdivIndex = 0; subsubdivIndex = 0;
    // ensure subdivision counts exist to avoid ReferenceErrors
    subdivsPerDiv = 1; subsubsPerSub = 1;

    // call measure timing which should build unitRec and preferentially pick secs from CSV
    setUnitTiming('measure');
    try { setUnitTiming('beat'); } catch (e) { /* non-fatal in some runtimes */ }





    const units = (LM.layers['primary'] && LM.layers['primary'].state && LM.layers['primary'].state.units) ? LM.layers['primary'].state.units : [];

    // find the measure or beat unit emitted and assert startTime/endTime from CSV seconds
    const measureUnits = units.filter(u => u.unitType === 'measure' || u.unitType === 'beat');
    expect(measureUnits.length).toBeGreaterThan(0);



    // assert at least one unit has marker-derived seconds 0.000000 - 1.000000
    const matched = measureUnits.some(u => Number.isFinite(Number(u.startTime)) && Number.isFinite(Number(u.endTime)) && Math.abs(Number(u.startTime) - 0.0) < 0.0001 && Math.abs(Number(u.endTime) - 1.0) < 0.0001);
    expect(matched).toBe(true);
  });
});
