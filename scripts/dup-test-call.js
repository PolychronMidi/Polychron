// Quick reproducer: call setUnitTiming('subsubdivision') multiple times and print units
TUNING_FREQ = 440; BINAURAL = { min: 0.1, max: 1.0 };
require('../src/writer');
require('../src/time');
require('../src/rhythm');
if (LM && LM.register) LM.register('primary','c1',{},() => {});
// deterministic
sectionIndex=0; phraseIndex=0; measureIndex=0; beatIndex=0;
tpSec=1000; tpMeasure=1000; spMeasure=1; phraseStart=0; phraseStartTime=0;
numerator=4; denominator=4; measuresPerPhrase=1;
composer = { getDivisions: () => 1, getSubdivisions: () => 7, getSubsubdivs: () => 4, getMeter: () => [4,4] };
BPM=120; PPQ=480; getMidiTiming();
measuresPerPhrase1 = 1; measuresPerPhrase2 = 1; LM.activate('primary', false);
__POLYCHRON_TEST__ = __POLYCHRON_TEST__ || {}; __POLYCHRON_TEST__.enableLogging = false;
divIndex=0; subdivIndex=0; subsubdivIndex=0; subdivsPerDiv = 7; subsubsPerSub = 4;
for (let i=0;i<6;i++) {
  try { setUnitTiming('subsubdivision'); } catch (e) { console.error('err', e && e.stack); }
  console.log('after call', i, 'tpBeat', tpBeat, 'tpDiv', tpDiv, 'tpSubdiv', tpSubdiv, 'tpSubsubdiv', tpSubsubdiv, 'subdivStart', subdivStart, 'subsubdivIndex', subsubdivIndex);
}
const units = (LM.layers['primary'] && LM.layers['primary'].state && LM.layers['primary'].state.units) ? LM.layers['primary'].state.units : [];
console.log('units length', units.length);
for (const [i,u] of units.entries()) console.log(i, u.unitType, u.startTick, u.endTick, 'subsub', u.subsubIndex);
