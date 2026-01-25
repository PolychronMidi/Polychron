import { it, expect, beforeEach } from 'vitest';

// Load runtime modules required for timing helpers
require('../../src/writer.js'); // CSVBuffer
require('../../src/time.js');
require('../../src/rhythm.js');

beforeEach(() => {
  // reset LM and small globals
  if (global.LM) { global.LM.layers = {}; global.LM.activeLayer = null; }
  global.m = Math;
  global.LOG = 'none';
});

it('flapping composer getters should be called only once per beat/division (cache test)', () => {
  let divCalls = 0;
  let subdivCalls = 0;

  global.composer = {
    getDivisions: () => { divCalls++; return (divCalls % 2 === 1) ? 3 : 1; },
    getSubdivisions: () => { subdivCalls++; return (subdivCalls % 2 === 1) ? 4 : 1; },
    getSubsubdivs: () => 1,
    getMeter: () => [4,4]
  };

  // initialize minimal timing environment
  global.sectionIndex = 0; global.phraseIndex = 0; global.measureIndex = 0; global.beatIndex = 0;
  global.tpSec = 1000; global.tpMeasure = 1000; global.spMeasure = 1; global.phraseStart = 0; global.phraseStartTime = 0;
  global.numerator = 4; global.denominator = 4; global.measuresPerPhrase = 1;
  global.beatRhythm = [1]; global.divRhythm = [1]; global.subdivRhythm = [1]; global.subsubdivRhythm = [1];

  // deterministic helpers used by rhythm.js
  global.ri = (a,b)=> (typeof b === 'undefined' ? Math.floor(a || 0) : a);
  global.rf = () => 0.5; global.rv = (a)=>a; global.ra = (v)=> (typeof v === 'function' ? v() : (Array.isArray(v) ? v[0] : v));

  // ensure MIDI timing values are initialized
  global.BPM = 120; global.PPQ = 480; getMidiTiming();
  global.measuresPerPhrase1 = 1; global.measuresPerPhrase2 = 1;

  // register and activate primary layer
  const { state: primary, buffer: c1 } = global.LM.register('primary', 'c1', {}, () => {});
  LM.activate('primary', false);

  globalThis.__POLYCHRON_TEST__ = globalThis.__POLYCHRON_TEST__ || {};
  globalThis.__POLYCHRON_TEST__.enableLogging = false;

  global.divIndex = 0; global.subdivIndex = 0; global.subsubdivIndex = 0;

  // Call timing in sequence; perform repeated calls that used to trigger multiple composer calls
  setUnitTiming('measure');
  setUnitTiming('beat');
  setUnitTiming('division');
  setUnitTiming('division');
  setUnitTiming('subdivision');
  setUnitTiming('subdivision');

  expect(divCalls).toBe(1);
  expect(subdivCalls).toBe(1);

  const units = (global.LM.layers['primary'] && global.LM.layers['primary'].state && global.LM.layers['primary'].state.units) ? global.LM.layers['primary'].state.units : [];
  expect(Array.isArray(units)).toBe(true);
});
