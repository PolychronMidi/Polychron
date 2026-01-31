// Aggregated entry point for the src/time modules.
// Allows `require('./time')` to pull in the collection of timing utilities
// and preserve the previous convenience of a single-folder import.

// LayerManager intentionally sets the LM naked global when required
require('./LayerManager');
const midiTiming = require('./midiTiming');
const setUnitTiming = require('./setUnitTiming');
const getPolyrhythm = require('./getPolyrhythm');

// Debug helpers that were previously reachable via time.js
const formatTime = require('../debug/formatTime');

// Expose a compact API surface for convenience
module.exports = {
  setUnitTiming,
  getPolyrhythm,
};

// Backwards-compatibility: export unscoped globals used by legacy imports/tests
try { Function('f', 'setUnitTiming = f')(setUnitTiming); } catch (e) { /* swallow */ }
try { Function('f', 'getPolyrhythm = f')(getPolyrhythm); } catch (e) { /* swallow */ }


// Ensure LM naked global exists by exporting and assigning
try { const LM_export = require('./LayerManager'); Function('f','LM = f')(LM_export); } catch (e) { /* swallow */ }
// Also export a default assignment for earlier `require('../src/time')` usages
try { module.exports = module.exports || module.exports; } catch (e) { /* swallow */ }
