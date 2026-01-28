// Reproduce cascading unit timing failure
require('../src/sheet');
require('../src/writer');
require('../src/backstage');
require('../src/rhythm');
require('../src/time');

numerator = 4; denominator = 4; BPM = 120; getMidiTiming();
LM.register('test', 'c1', { phraseStart: 0, phraseStartTime: 0 });
LM.activate('test');
// Composer stub for deterministic behavior
composer = { getDivisions: () => 2, getSubdivs: () => 2, getSubsubdivs: () => 1, getMeter: () => [4,4] };
// Ensure a minimal `p` writer is available for this debug run
p = (buff, ...items) => { try { buff.push(...items); } catch (e) { buff.events = buff.events || []; buff.events.push(items); } };
// Ensure a minimal `logUnit` writer for this debug run
logUnit = (type) => { return null; };

// Set measure timing
measureIndex = 1;
setUnitTiming('measure');
console.log('measureStart', measureStart, 'measureStartTime', measureStartTime, 'tpMeasure', tpMeasure, 'phraseStart', phraseStart, 'phraseStartTime', phraseStartTime);

// Enable debug tracing
__POLYCHRON_TEST__ = __POLYCHRON_TEST__ || {}; __POLYCHRON_TEST__.DEBUG = true;
// Set beat timing (should cascade from measureStart)
beatIndex = 2;
setUnitTiming('beat');
console.log('beatStart', beatStart, 'beatStartTime', beatStartTime, 'tpBeat', tpBeat, 'measureStart', measureStart, 'measureStartTime', measureStartTime);

// Set division timing (should cascade from beatStart)
divIndex = 1;
try {
  setUnitTiming('division');
  console.log('divStart', divStart, 'tpDiv', tpDiv, 'beatStart', beatStart);
} catch (e) {
  console.error('ERROR during division:', e && e.stack ? e.stack : e);
}
