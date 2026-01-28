import { test, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// Ensure runtime modules are loaded
require('../src/writer.js');
require('../src/time.js');
require('../src/rhythm.js');

const OUT = path.join(process.cwd(), 'output');

beforeEach(() => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);
  // reset LM state
  if (LM) { LM.layers = {}; LM.activeLayer = null; }
  // deterministic defaults
  m = Math; LOG = 'none';
});

test('setUnitTiming throws CRITICAL for out-of-range beatIndex', () => {
  // set up a deterministic measure/beat setup where beatIndex equals numerator (off-by-one)
  const { state: primary, buffer: c1 } = LM.register('primary', 'c1', {}, () => {});

  // indexes and timing
  sectionIndex = 0; phraseIndex = 0; measureIndex = 0; beatIndex = 4; // intentionally equal to numerator
  tpSec = 1000; tpMeasure = 1000; spMeasure = 1; phraseStart = 0; phraseStartTime = 0;
  numerator = 4; denominator = 4; measuresPerPhrase = 1;
  // rhythm arrays present
  beatRhythm = [1,1,1,1]; divRhythm = [1]; subdivRhythm = [1]; subsubdivRhythm = [1];
  // random helpers
  m = Math; ri = (...a) => (a.length === 1 ? Math.floor(a[0]) : a[0]); rf = (a,b) => (typeof b === 'undefined' ? (a || 0.5) : a);
  rv = (a,b,c) => a; ra = v => (typeof v === 'function' ? v() : (Array.isArray(v) ? v[0] : v));

  composer = { getDivisions: () => 1, getSubdivisions: () => 1, getSubsubdivs: () => 1, getMeter: () => [4,4] };
  BPM = 120; PPQ = 480; getMidiTiming();

  // call beat timing - out-of-range should throw CRITICAL rather than silently clamp
  expect(() => setUnitTiming('beat')).toThrow(/CRITICAL/);
});
