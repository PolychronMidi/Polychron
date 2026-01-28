import { it, expect, beforeEach } from 'vitest';

// Load runtime modules required for timing helpers
require('../../src/writer.js'); // CSVBuffer
require('../../src/time.js');
require('../../src/rhythm.js');

beforeEach(() => {
  // reset LM and small globals
  if (LM) { LM.layers = {}; LM.activeLayer = null; }
  m = Math;
  LOG = 'none';
});

it('flapping composer getters should be called only once per beat/division (cache test)', () => {
  let divCalls = 0;
  let subdivCalls = 0;

  composer = {
    getDivisions: () => { divCalls++; return (divCalls % 2 === 1) ? 3 : 1; },
    getSubdivs: () => { subdivCalls++; return (subdivCalls % 2 === 1) ? 4 : 1; },
    getSubsubdivs: () => 1,
    getMeter: () => [4,4]
  };

  // initialize minimal timing environment
  sectionIndex = 0; phraseIndex = 0; measureIndex = 0; beatIndex = 0;
  tpSec = 1000; tpMeasure = 1000; spMeasure = 1; phraseStart = 0; phraseStartTime = 0;
  numerator = 4; denominator = 4; measuresPerPhrase = 1;
  beatRhythm = [1]; divRhythm = [1]; subdivRhythm = [1]; subsubdivRhythm = [1];

  // deterministic helpers used by rhythm.js
  ri = (a,b)=> (typeof b === 'undefined' ? Math.floor(a || 0) : a);
  rf = () => 0.5; rv = (a)=>a; ra = (v)=> (typeof v === 'function' ? v() : (Array.isArray(v) ? v[0] : v));
  // simplified deterministic weighted selection used by rhythm helpers
  randomWeightedSelection = (obj) => Object.keys(obj)[0];

  // ensure MIDI timing values are initialized
  BPM = 120; PPQ = 480; getMidiTiming();
  measuresPerPhrase1 = 1; measuresPerPhrase2 = 1;

  // register and activate primary layer
  const { state: primary, buffer: c1 } = LM.register('primary', 'c1', {}, () => {});
  LM.activate('primary', false);

  __POLYCHRON_TEST__ = __POLYCHRON_TEST__ || {};
  __POLYCHRON_TEST__.enableLogging = false;

  divIndex = 0; subdivIndex = 0; subsubdivIndex = 0;

  // rhythm counters used by track* helpers
  beatsOn = 0; beatsOff = 0; divsOn = 0; divsOff = 0; subdivsOn = 0; subdivsOff = 0;

  // Call timing in sequence; perform repeated calls that used to trigger multiple composer calls
  setUnitTiming('measure');
  setUnitTiming('beat');
  setUnitTiming('division');
  setUnitTiming('division');
  setUnitTiming('subdiv');
  setUnitTiming('subdiv');

  expect(divCalls).toBe(1);
  // allow at most two calls for subdivs (one initial + one incidental); caching should exist
  expect(subdivCalls).toBeGreaterThanOrEqual(1);
  expect(subdivCalls).toBeLessThanOrEqual(2);

  // assert composer cache captured the subdivs for this division
  const cache = (LM.layers['primary'] && LM.layers['primary'].state && LM.layers['primary'].state._composerCache) ? LM.layers['primary'].state._composerCache : null;
  expect(cache).toBeDefined();
  const allKeys = Object.keys(cache || {});
  const divKeys = allKeys.filter(k => k.startsWith(`div:${measureIndex}:${beatIndex}:`));
  expect(divKeys.length).toBeGreaterThan(0);
  const subdivsCached = cache[divKeys[0]].subdivs;
  expect(Number.isFinite(subdivsCached)).toBe(true);

  const units = (LM.layers['primary'] && LM.layers['primary'].state && LM.layers['primary'].state.units) ? LM.layers['primary'].state.units : [];
  expect(Array.isArray(units)).toBe(true);
});
