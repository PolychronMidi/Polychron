// test/time.postfix-critical.test.js
require('../src/sheet');
require('../src/writer');
require('../src/backstage');
require('../src/time');

const fs = require('fs');

beforeEach(() => {
  // Reset globals to a known good base
  numerator = 4;
  denominator = 4;
  BPM = 120;
  PPQ = 480;
  sectionStart = 0;
  phraseStart = 0;
  measureStart = 0;
  phraseStartTime = 0;
  measureStartTime = 0;
  tpMeasure = 480 * 4;
  tpSec = 480 * 4;
  tpPhrase = tpMeasure * 4;
  measuresPerPhrase = 4;
  // Ensure LM layer state exists
  LM = LM || { layers: { primary: { state: { units: [] }, buffer: [] } }, activeLayer: 'primary' };
});

describe('time critical enforcement', () => {
  test('invalid measuresPerPhrase throws critical error', () => {
    measuresPerPhrase = 0; // invalid
    expect(() => setUnitTiming('phrase')).toThrow(/CRITICAL/);
  });

  test('measure bounds outside phrase throws critical error', () => {
    // Set a tiny phrase and large tpMeasure so measure exceeds phrase
    phraseStart = 0;
    tpPhrase = 1000; // small phrase
    tpMeasure = 2000; // large measure
    measureIndex = 0;
    expect(() => setUnitTiming('measure')).toThrow(/CRITICAL/);
  });

  test('beat bounds outside measure throws critical error', () => {
    tpMeasure = 1000;
    tpBeat = 800; // too big for beats within measure
    measureIndex = 0; beatIndex = 0;
    expect(() => setUnitTiming('beat')).toThrow(/CRITICAL/);
  });

  test('missing composer subsubdivs throws critical error', () => {
    // Remove composer.getSubsubdivs to simulate missing getter
    composer = { getDivisions: () => 2, getSubdivisions: () => 2, constructor: { name: 'X' } };
    measureIndex = 0; beatIndex = 0; divIndex = 0; subdivIndex = 0;
    expect(() => setUnitTiming('subdivision')).toThrow(/CRITICAL/);
  });

  test('overlap detection throws critical error', () => {
    // Simulate an existing unit that overlaps the new one
    LM.layers.primary.state.units = [{ unitType: 'measure', startTick: 100, endTick: 200 }];
    phraseStart = 0; tpMeasure = 150; measureIndex = 0;
    // New measureStart will be 0 + 0 * 150 = 0 and end 150 -> overlaps existing 100-200
    expect(() => setUnitTiming('measure')).toThrow(/CRITICAL/);
  });

  test('subsubdivision span cap throws critical error', () => {
    // create a case where subsubdivision span is larger than measure * 1.5
    tpMeasure = 4800; // big measure
    tpSubdiv = 2400; subsubsPerSub = 1; subsubdivIndex = 0;
    // Force tpSubsubdiv to equal tpSubdiv (since subsubsPerSub=1) which is large
    expect(() => setUnitTiming('subsubdivision')).toThrow(/CRITICAL/);
  });
});
