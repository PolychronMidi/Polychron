// debug-setUnitTiming.js
require('../src/sheet');
require('../src/writer');
require('../src/backstage');
require('../src/time');

// configure test scenario
phraseStart = 0;
tpPhrase = 1000;
tpMeasure = 2000;
measureIndex = 0;
try {
  setUnitTiming('measure');
  console.log('no exception');
} catch (e) {
  console.error('THROWN:', e && e.stack ? e.stack : e);
}
