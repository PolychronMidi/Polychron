import { test, expect, beforeEach } from 'vitest';

// Simulate the real play switching sequence where composer supplies a new meter
// for poly and ensure a subsequent setUnitTiming('beat') does not raise CRITICAL
// due to stale derived MIDI timing values.

beforeEach(() => {
  // Require runtime modules for accurate behavior
  require('../src/writer.js'); require('../src/time.js'); require('../src/rhythm.js');
  // reset globals
  numerator = 4; denominator = 4; measuresPerPhrase = 1;
  BPM = 120; PPQ = 480; // ensure getMidiTiming can run
  if (typeof getMidiTiming === 'function') getMidiTiming();
  // ensure a fresh LM state
  if (LM && LM.layers) LM.layers = {};
});

test('switching layers with different meters should not produce boundary CRITICAL', () => {
  // Register primary and poly
  const { state: primary } = LM.register('primary', 'c1', { numerator: 4, denominator: 4, measuresPerPhrase: 1 });
  const { state: poly } = LM.register('poly', 'c2', { numerator: 5, denominator: 4, measuresPerPhrase: 1 });

  // Simulate play sequence: start primary (numerator=4)
  numerator = 4; denominator = 4; getMidiTiming();
  LM.activate('primary', false);
  // Set phrase/measure/beat indices
  sectionIndex = 0; phraseIndex = 0; measureIndex = 0; beatIndex = 0;
  // call phrase->measure->beat timing to populate state; should not throw
  expect(() => { setUnitTiming('phrase'); setUnitTiming('measure'); setUnitTiming('beat'); }).not.toThrow();

  // Now switch to poly which has a different meter
  polyNumerator = 5; polyDenominator = 4; // poly meter
  // In actual play, getPolyrhythm might be called; emulate handler: set global numerator/denominator
  numerator = polyNumerator; denominator = polyDenominator; getMidiTiming();
  LM.activate('poly', true);
  // call a few units on poly to exercise path
  expect(() => { setUnitTiming('phrase'); setUnitTiming('measure'); setUnitTiming('beat'); }).not.toThrow();

  // Switch back to primary - the timing restore must recompute derived timing so following beat is valid
  LM.activate('primary', false);
  // set beatIndex to 1 to test boundary computation within measure
  beatIndex = 1;
  expect(() => { setUnitTiming('beat'); }).not.toThrow();
});
