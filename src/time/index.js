// Aggregated entry point for the src/time modules.
// Allows `require('./time')` to pull in the collection of timing utilities
// and preserve the previous convenience of a single-folder import.

const TimingContext = require('./TimingContext');
const TimingCalculator = require('./TimingCalculator');
// LayerManager intentionally sets the LM naked global when required
require('./LayerManager');
const setMidiTiming = require('./setMidiTiming');
const setUnitTiming = require('./setUnitTiming');
const getPolyrhythm = require('./getPolyrhythm');

// Debug helpers that were previously reachable via time.js
const formatTime = require('../debug/formatTime');

// Expose a compact API surface for convenience
module.exports = {
  TimingContext,
  TimingCalculator,
  setMidiTiming,
  setUnitTiming,
  getPolyrhythm,
};

// Backwards-compatibility: export unscoped globals used by legacy imports/tests
try { Function('f', 'setUnitTiming = f')(setUnitTiming); } catch (e) { /* swallow */ }
try { Function('f', 'setMidiTiming = f')(setMidiTiming); } catch (e) { /* swallow */ }
try { Function('f', 'getPolyrhythm = f')(getPolyrhythm); } catch (e) { /* swallow */ }
try { Function('f', 'TimingContext = f')(TimingContext); } catch (e) { /* swallow */ }
try { Function('f', 'TimingCalculator = f')(TimingCalculator); } catch (e) { /* swallow */ }


// Ensure LM naked global exists by exporting and assigning
try { const LM_export = require('./LayerManager'); Function('f','LM = f')(LM_export); } catch (e) { /* swallow */ }
// Also export a default assignment for earlier `require('../src/time')` usages
try { module.exports = module.exports || module.exports; } catch (e) { /* swallow */ }
