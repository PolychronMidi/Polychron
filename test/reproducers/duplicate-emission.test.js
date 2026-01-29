import { describe, it, expect, beforeEach } from 'vitest';
const fs = require('fs');

// This reproducer asserts that duplicate unit emissions should NOT occur.
// It is intentionally written to fail while the duplicate-push bug is present so
// that the failure can be used to drive the root-cause fix.

describe('regression: duplicate unit emissions', () => {
  beforeEach(() => {
    // reset LM and outputs
    try { fs.unlinkSync('output/output1.csv'); } catch (e) { /* swallow */ }
    try { fs.unlinkSync('output/output2.csv'); } catch (e) { /* swallow */ }

    if (typeof LM !== 'undefined' && LM) { LM.layers = {}; LM.activeLayer = null; }

    // Minimal sane runtime globals required by setUnitTiming
    // These mirror the deterministic setup used in reproducer scripts
    TUNING_FREQ = 440;
    BINAURAL = { min: 0.1, max: 1.0 };

    require('../../src/writer.js'); // sets up CSVBuffer, logUnit
    require('../../src/time.js');
    require('../../src/rhythm.js');

    // Register primary layer
    if (LM && LM.register) LM.register('primary', 'c1', {}, () => {});

    // Deterministic timing & composer stubs
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

    // ensure counters and indices exist
    beatsOn = 0; beatsOff = 0; divsOn = 0; divsOff = 0; subdivsOn = 0; subdivsOff = 0;
    const TEST = require('../../src/test-hooks'); TEST.enableLogging = false;
    divIndex = 0; subdivIndex = 0; subsubdivIndex = 0; subdivsPerDiv = 7; subsubsPerSub = 4;
  });

  it('should not emit duplicate subsubdiv unit records (regression)', () => {
    // Call setUnitTiming multiple times to increase chance of reproducing duplicate push
    for (let i = 0; i < 6; i++) {
      try {
        setUnitTiming('subsubdiv');
      } catch (e) {
        // If setUnitTiming throws (CRITICAL) in some runtimes, fail the test with details
        throw new Error(`setUnitTiming threw unexpectedly: ${e && e.stack ? e.stack : String(e)}`);
      }
    }

    const units = (LM.layers['primary'] && LM.layers['primary'].state && LM.layers['primary'].state.units) ? LM.layers['primary'].state.units : [];

    // Build canonical key counts by unitType + parent indices + tick range
    const counts = units.reduce((acc, u) => {
      if (!u) return acc;
      const key = `${u.unitType}|${u.sectionIndex}|${u.phraseIndex}|${u.measureIndex}|${u.startTick}-${u.endTick}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const duplicates = Object.entries(counts).filter(([k,v]) => v > 1);

    // This test asserts no duplicates; it is expected to fail until root cause is fixed
    expect(duplicates.length).toBe(0);
  });
});
