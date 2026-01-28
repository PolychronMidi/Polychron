// Debug subsubdiv span cap check
require('./../src/test-setup');
require('./../src/backstage');
require('./../src/time');
// Set up minimal LM
LM = { layers: { primary: { state: { units: [] }, buffer: [] } }, activeLayer: 'primary' };
// Set the global variables per test
tpMeasure = 4800;
tpSubdiv = 2400;
subsubsPerSub = 1;
subsubdivIndex = 0;
subdivStart = 0; subdivStartTime = 0;
// Ensure tpSec is present as in test beforeEach
tpSec = 480 * 4;
try {
  console.log('Before call', { tpMeasure, tpSubdiv, subsubsPerSub, subsubdivIndex, subdivStart });
  setUnitTiming('subsubdiv');
  console.log('setUnitTiming returned without throwing');
} catch (e) {
  console.error('setUnitTiming threw', e && e.message);
}
