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
const restoreLayerToGlobals = require('./restoreLayerToGlobals');
const markerMap = require('./markerMap');

// Debug helpers that were previously reachable via time.js
const getMidiTiming = require('../debug/getMidiTiming');
const formatTime = require('../debug/formatTime');
const warnOnce = require('../debug/warnOnce');
const raiseCritical = require('../debug/raiseCritical');

// Expose a compact API surface for convenience
module.exports = {
  TimingContext,
  TimingCalculator,
  setMidiTiming,
  setUnitTiming,
  getPolyrhythm,
  restoreLayerToGlobals,
  // Spread markerMap exports (loadMarkerMapForLayer, findMarkerSecs, clearMarkerCache, etc.)
  ...markerMap,
  // debug helpers
  getMidiTiming,
  formatTime,
  warnOnce,
  raiseCritical
};

// Backwards-compatibility: export unscoped globals used by legacy imports/tests
try { Function('f', 'setUnitTiming = f')(setUnitTiming); } catch (e) { /* swallow */ }
try { Function('f', 'setMidiTiming = f')(setMidiTiming); } catch (e) { /* swallow */ }
try { Function('f', 'getPolyrhythm = f')(getPolyrhythm); } catch (e) { /* swallow */ }
try { Function('f', 'TimingContext = f')(TimingContext); } catch (e) { /* swallow */ }
try { Function('f', 'TimingCalculator = f')(TimingCalculator); } catch (e) { /* swallow */ }
try { Function('f', 'restoreLayerToGlobals = f')(restoreLayerToGlobals); } catch (e) { /* swallow */ }
try { Function('f', 'getMidiTiming = f')(getMidiTiming); } catch (e) { /* swallow */ }
try { Function('f', 'formatTime = f')(formatTime); } catch (e) { /* swallow */ }
try { Function('f', 'warnOnce = f')(warnOnce); } catch (e) { /* swallow */ }
try { Function('f', 'raiseCritical = f')(raiseCritical); } catch (e) { /* swallow */ }

// Ensure LM naked global exists by exporting and assigning
try { const LM_export = require('./LayerManager'); Function('f','LM = f')(LM_export); } catch (e) { /* swallow */ }
// Also export a default assignment for earlier `require('../src/time')` usages
try { module.exports = module.exports || module.exports; } catch (e) { /* swallow */ }
