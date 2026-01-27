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
  numerator = 4;
  denominator = 4;
  BPM = 120;
  PPQ = 480;
  sectionStart = 0;
  phraseStart = 0;
  measureStart = 0;
  beatStart = 0;
  divStart = 0;
  subdivStart = 0;
  subsubdivStart = 0;
  sectionStartTime = 0;
  phraseStartTime = 0;
  measureStartTime = 0;
  beatStartTime = 0;
  divStartTime = 0;
  subdivStartTime = 0;
  subsubdivStartTime = 0;
  tpSection = 0;
  spSection = 0;
  spMeasure = 0;
  composer = { ...mockComposer };
  c = [];
  LOG = 'none';
}

function run() {
  setupGlobalState();
  composer = mockComposer;
  setRhythm = () => [1,1,1,1];
  trackBeatRhythm = () => {};
  trackDivRhythm = () => {};
  trackSubdivRhythm = () => {};
  trackSubsubdivRhythm = () => {};
  logUnit = () => {};

  numerator = 4;
  denominator = 4;
  BPM = 120;
  getMidiTiming();

  const { state: state1 } = LM.register('layer1', 'c1', { phraseStart: 0, phraseStartTime: 0 });
  const { state: state2 } = LM.register('layer2', 'c2', { phraseStart: 1920, phraseStartTime: 2.0 });

  measureIndex = 0;
  LM.activate('layer1');
  setUnitTiming('measure');
  console.log('after activate layer1 measureStart', measureStart, 'phraseStart', phraseStart);

  measuresPerPhrase = 1;
  tpPhrase = tpMeasure;
  spPhrase = spMeasure;
  LM.advance('layer1', 'phrase');
  console.log('after advance layer1 state.phraseStart', LM.layers['layer1'].state.phraseStart);

  measureIndex = 0;
  LM.activate('layer2');
  setUnitTiming('measure');
  console.log('after activate layer2, measureStart', measureStart, 'phraseStart', phraseStart);

  measureIndex = 0;
  LM.activate('layer1');
  setUnitTiming('measure');
  console.log('after re-activate layer1, measureStart', measureStart, 'phraseStart', phraseStart);

  measureIndex = 1;
  LM.activate('layer1');
  setUnitTiming('measure');
  console.log('after set measureIndex 1 and activate layer1, measureStart', measureStart, 'expected', 2 * tpMeasure);
}
try { run(); } catch(e) { console.error('ERR', e && e.stack ? e.stack : e); process.exit(1); }
