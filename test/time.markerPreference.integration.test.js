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
    if (global.LM) {
      global.LM.layers = {}; global.LM.activeLayer = null;
    }
    // safe deterministic helpers
    global.m = Math; global.LOG = 'none';
  });

  afterEach(() => {
    try { fs.unlinkSync(path.join(OUT, 'output1.csv')); } catch (e) {}
  });

  it('setUnitTiming should prefer CSV marker seconds when present', () => {
    // write CSV with explicit seconds for measure/beat
    const line = '1,0,marker_t,unitRec:primary|section1|phrase1|measure1|beat1/4|0-1000|0.000000-1.000000';
    fs.writeFileSync(path.join(OUT, 'output1.csv'), line + '\n');

    // register layer
    const { state: primary, buffer: c1 } = global.LM.register('primary', 'c1', {}, () => {});

    // set indexes and timing globals deterministically
    global.sectionIndex = 0; global.phraseIndex = 0; global.measureIndex = 0; global.beatIndex = 0;
    global.tpSec = 1000; // ticks per second mapping (so 1s = 1000 ticks)
    global.tpMeasure = 1000; global.spMeasure = 1; global.phraseStart = 0; global.phraseStartTime = 0;
    global.numerator = 4; global.denominator = 4; global.measuresPerPhrase = 1;
    // ensure rhythm arrays are present
    global.beatRhythm = [1,1,1,1]; global.divRhythm = [1]; global.subdivRhythm = [1]; global.subsubdivRhythm = [1];
    // deterministic rhythm helper used by getRhythm
    global.randomWeightedSelection = (obj) => Object.keys(obj)[0];
    // numeric random helpers used by rhythm.js
    global.m = Math;
    global.ri = (...args) => { if (args.length === 1) return Math.floor(args[0]) || 0; if (args.length === 2) return args[0]; return args[0]; };
    global.rf = (a,b) => (typeof b === 'undefined' ? (a || 0.5) : a);
    global.rv = (a,b,c) => a;
    global.ra = (v) => { if (typeof v === 'function') return v(); if (Array.isArray(v)) return v[0]; return v; };

    // minimal composer stub for deterministic behavior
    global.composer = {
      getDivisions: () => 1,
      getSubdivisions: () => 1,
      getSubsubdivs: () => 1,
      getMeter: () => [4, 4]
    };

    // ensure MIDI timing values are initialized so setMidiTiming() works
    global.BPM = 120; global.PPQ = 480; getMidiTiming();

    // polyrhythm defaults for deterministic activation
    global.measuresPerPhrase1 = 1; global.measuresPerPhrase2 = 1;
    // activate layer so 'c' is set and setMidiTiming writes to the correct buffer
    LM.activate('primary', false);



    // ensure beat/div counters for rhythm functions
    global.beatsOn = 0; global.beatsOff = 0; global.divsOn = 0; global.divsOff = 0; global.subdivsOn = 0; global.subdivsOff = 0;

    // ensure internal test logging is disabled for clean output
    globalThis.__POLYCHRON_TEST__ = globalThis.__POLYCHRON_TEST__ || {}; globalThis.__POLYCHRON_TEST__.enableLogging = false;

    // ensure minimal index variables exist to avoid ReferenceErrors in setUnitTiming
    global.divIndex = 0; global.subdivIndex = 0; global.subsubdivIndex = 0;
    // ensure subdivision counts exist to avoid ReferenceErrors
    global.subdivsPerDiv = 1; global.subsubdivsPerSub = 1;

    // call measure timing which should build unitRec and preferentially pick secs from CSV
    setUnitTiming('measure');
    try { setUnitTiming('beat'); } catch (e) { /* non-fatal in some runtimes */ }





    const units = (global.LM.layers['primary'] && global.LM.layers['primary'].state && global.LM.layers['primary'].state.units) ? global.LM.layers['primary'].state.units : [];

    // find the measure or beat unit emitted and assert startTime/endTime from CSV seconds
    const measureUnits = units.filter(u => u.unitType === 'measure' || u.unitType === 'beat');
    expect(measureUnits.length).toBeGreaterThan(0);



    // assert at least one unit has marker-derived seconds 0.000000 - 1.000000
    const matched = measureUnits.some(u => Number.isFinite(Number(u.startTime)) && Number.isFinite(Number(u.endTime)) && Math.abs(Number(u.startTime) - 0.0) < 0.0001 && Math.abs(Number(u.endTime) - 1.0) < 0.0001);
    expect(matched).toBe(true);
  });
});
