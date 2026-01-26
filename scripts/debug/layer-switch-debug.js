#!/usr/bin/env node
require('../../src/sheet');
require('../../src/writer');
require('../../src/backstage');
require('../../src/time');

const mockComposer = {
  getMeter: () => [4, 4],
  getDivisions: () => 2,
  getSubdivisions: () => 2,
  getSubsubdivs: () => 1,
  constructor: { name: 'MockComposer' },
  root: 'C',
  scale: { name: 'major' }
};

function setupGlobalState() {
  globalThis.numerator = 4;
  globalThis.denominator = 4;
  globalThis.BPM = 120;
  globalThis.PPQ = 480;
  globalThis.sectionStart = 0;
  globalThis.phraseStart = 0;
  globalThis.measureStart = 0;
  globalThis.beatStart = 0;
  globalThis.divStart = 0;
  globalThis.subdivStart = 0;
  globalThis.subsubdivStart = 0;
  globalThis.sectionStartTime = 0;
  globalThis.phraseStartTime = 0;
  globalThis.measureStartTime = 0;
  globalThis.beatStartTime = 0;
  globalThis.divStartTime = 0;
  globalThis.subdivStartTime = 0;
  globalThis.subsubdivStartTime = 0;
  globalThis.tpSection = 0;
  globalThis.spSection = 0;
  globalThis.spMeasure = 0;
  globalThis.composer = { ...mockComposer };
  globalThis.c = [];
  globalThis.LOG = 'none';
}

function run() {
  setupGlobalState();
  globalThis.composer = mockComposer;
  globalThis.setRhythm = () => [1,1,1,1];
  globalThis.trackBeatRhythm = () => {};
  globalThis.trackDivRhythm = () => {};
  globalThis.trackSubdivRhythm = () => {};
  globalThis.trackSubsubdivRhythm = () => {};
  globalThis.logUnit = () => {};

  globalThis.numerator = 4;
  globalThis.denominator = 4;
  globalThis.BPM = 120;
  getMidiTiming();

  const { state: state1 } = LM.register('layer1', 'c1', { phraseStart: 0, phraseStartTime: 0 });
  const { state: state2 } = LM.register('layer2', 'c2', { phraseStart: 1920, phraseStartTime: 2.0 });

  globalThis.measureIndex = 0;
  LM.activate('layer1');
  setUnitTiming('measure');
  console.log('after activate layer1 measureStart', globalThis.measureStart, 'phraseStart', globalThis.phraseStart);

  globalThis.measuresPerPhrase = 1;
  globalThis.tpPhrase = globalThis.tpMeasure;
  globalThis.spPhrase = globalThis.spMeasure;
  LM.advance('layer1', 'phrase');
  console.log('after advance layer1 state.phraseStart', LM.layers['layer1'].state.phraseStart);

  globalThis.measureIndex = 0;
  LM.activate('layer2');
  setUnitTiming('measure');
  console.log('after activate layer2, measureStart', globalThis.measureStart, 'phraseStart', globalThis.phraseStart);

  globalThis.measureIndex = 0;
  LM.activate('layer1');
  setUnitTiming('measure');
  console.log('after re-activate layer1, measureStart', globalThis.measureStart, 'phraseStart', globalThis.phraseStart);

  globalThis.measureIndex = 1;
  LM.activate('layer1');
  setUnitTiming('measure');
  console.log('after set measureIndex 1 and activate layer1, measureStart', globalThis.measureStart, 'expected', 2 * globalThis.tpMeasure);
}
try { run(); } catch(e) { console.error('ERR', e && e.stack ? e.stack : e); process.exit(1); }
