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
  // Ensure LM layer state exists (reset each test to avoid cross-test pollution)
  LM = { layers: { primary: { state: { units: [] }, buffer: [] } }, activeLayer: 'primary' };
  // Provide a minimal composer with expected getters when tests do not override it
  composer = composer || { getDivisions: () => 2, getSubdivs: () => 2, getSubsubdivs: () => 1, constructor: { name: 'TestComposer' } };
});

describe('time critical enforcement', () => {
  test('invalid measuresPerPhrase throws critical error', () => {
    measuresPerPhrase = 0; // invalid
    expect(() => setUnitTiming('phrase')).toThrow(/CRITICAL/);
  });

  test('phrase bounds outside section reconciles on last phrase', () => {
    tpSection = 1000;
    tpPhrase = 800; // too big relative to current section bound
    sectionIndex = 0; phraseIndex = 1; phrasesPerSection = 2; // last phrase
    const TEST = require('../src/test-hooks'); TEST.DEBUG = true; // enable debug traces for this test
    try { const fs = require('fs'); fs.writeFileSync(require('path').join(process.cwd(),'output','phrase-ctx.json'), JSON.stringify({ phraseStart, sectionStart, tpPhrase, tpSection, phraseIndex, phrasesPerSection, measuresPerPhrase }, null, 2)); } catch (_e) { /* swallow */ }
    // On the final phrase, the implementation should reconcile tpSection rather than fail
    expect(() => setUnitTiming('phrase')).not.toThrow();
    // Ensure tpSection increased to include the final phrase
    expect(Number(tpSection)).toBeGreaterThanOrEqual(Number(phraseStart + tpPhrase));
  });


  test('measure bounds outside phrase throws critical error (unit bounds cannot extent past parent bounds)', () => {
    // Set a tiny phrase and large tpMeasure so measure exceeds phrase
    phraseStart = 0;
    tpPhrase = 1000; // small phrase
    tpMeasure = 2000; // large measure
    measureIndex = 0;
    expect(() => setUnitTiming('measure')).toThrow(/CRITICAL/);
  });

  test('beat bounds outside measure throws critical error', () => {
    tpMeasure = 1000;
    tpBeat = 800; // too big for beats within measure when beatIndex>0
    measureIndex = 0; beatIndex = 1;
    expect(() => setUnitTiming('beat')).toThrow(/CRITICAL/);
  });

  test('subdiv bounds outside beat throws critical error', () => {
    tpBeat = 1000;
    tpSubdiv = 800; // too big for beats within measure when beatIndex>0
    beatIndex = 0; subdivIndex = 1;
    expect(() => setUnitTiming('subdiv')).toThrow(/CRITICAL/);
  });

  test('subsubdiv bounds outside subdiv throws critical error', () => {
    tpSubdiv = 1000;
    tpSubsubdiv = 800; // too big for beats within measure when beatIndex>0
    subdivIndex = 0; subsubdivIndex = 1;
    expect(() => setUnitTiming('subsubdiv')).toThrow(/CRITICAL/);
  });



  test('missing composer subsubdivs throws critical error', () => {
    // Remove composer.getSubsubdivs to simulate missing getter
    composer = { getDivisions: () => 2, getSubdivs: () => 2, constructor: { name: 'X' } };
    measureIndex = 0; beatIndex = 0; divIndex = 0; subdivIndex = 0;
    expect(() => setUnitTiming('subdiv')).toThrow(/CRITICAL/);
  });

  test('overlap detection throws critical error', () => {
    // Simulate an existing unit that overlaps the new one
    LM.layers.primary.state.units = [{ unitType: 'measure', startTick: 100, endTick: 200 }];
    phraseStart = 0; tpMeasure = 150; measureIndex = 0;
    // New measureStart will be 0 + 0 * 150 = 0 and end 150 -> overlaps existing 100-200
    try { const TEST = require('../src/test-hooks'); TEST.DEBUG = true; TEST.enableLogging = true; } catch (e) { /* swallow */ }
    expect(() => setUnitTiming('measure')).toThrow(/CRITICAL/);
  });

  test('single-tick overlap tolerated (rounding)', () => {
    // Existing measure ends at 200; new measure will start at 199 and end 299 -> 1 tick overlap
    LM.layers.primary.state.units = [{ unitType: 'measure', startTick: 100, endTick: 200 }];
    phraseStart = 99; tpMeasure = 100; measureIndex = 1; // measureStart = 99 + 1*100 = 199
    expect(() => setUnitTiming('measure')).not.toThrow();
  });

});
