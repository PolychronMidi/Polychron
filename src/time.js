// time.js - Timing engine with meter spoofing and dual-layer polyrhythm support.
// minimalist comments, details at: time.md

const { writeIndexTrace, writeDebugFile, appendToFile, writeFatal } = require('./logGate');
const m = Math;

// TimingCalculator moved to its own module to keep `time.js` smaller and more testable.
TimingCalculator = require('./time/TimingCalculator');

// Export TimingCalculator to test hooks and for other modules
// Use centralized test hooks instead of global mutation
const TEST = require('./test-hooks');
// One-time warning helper (moved to its own module at src/debug/warnOnce.js)
const warnOnce = require('./debug/warnOnce');
try { Function('f', 'this.warnOnce = f')(warnOnce); } catch (e) { /* swallow */ }

// Fail-fast critical handler (moved to `src/debug/raiseCritical.js`)
const raiseCritical = require('./debug/raiseCritical');
try { Function('f', 'this.raiseCritical = f')(raiseCritical); } catch (e) { /* swallow */ }
let timingCalculator = null;
let restoreLayerToGlobals;

// Compute MIDI-compatible meter and tempo sync factor (moved to `src/debug/getMidiTiming.js`)
const getMidiTiming = require('./debug/getMidiTiming');
try { Function('f', 'this.getMidiTiming = f')(getMidiTiming); } catch (e) { /* swallow */ }

// Load TimingContext implementation from its own module to reduce file size and improve testability
TimingContext = require('./time/TimingContext');
// Load LayerManager which sets global LM for tests and runtime (legacy naked-global semantics kept)
require('./time/LayerManager');
/**
 * Write MIDI timing events to the active buffer.
 * Implemented in `src/time/setMidiTiming.js`.
 * @param {number} [tick] - MIDI tick position.
 */
setMidiTiming = require('./time/setMidiTiming');
/**
 * Set timing variables for each unit level. Implemented in `src/time/setUnitTiming.js`.
 * @param {string} unitType - Unit type for timing calculation and logging.
 */
setUnitTiming = require('./time/setUnitTiming');
getPolyrhythm = require('./time/getPolyrhythm');
try { Function('f', 'this.getPolyrhythm = f')(getPolyrhythm); } catch (e) { /* swallow */ }

const formatTime = require('./debug/formatTime');
try { Function('f', 'this.formatTime = f')(formatTime); } catch (e) { /* swallow */ }

// Marker map delegated to `src/time/markerMap.js` (imported directly)
const { _csvPathForLayer, loadMarkerMapForLayer, findMarkerSecs, clearMarkerCache } = require('./time/markerMap');



// Export public API for programmatic imports and testing
try {
  module.exports = module.exports || {};
  module.exports.TimingCalculator = TimingCalculator;
  module.exports.getMidiTiming = getMidiTiming;
  module.exports.formatTime = formatTime;
  module.exports.getPolyrhythm = getPolyrhythm;
  module.exports.warnOnce = warnOnce;
  module.exports.raiseCritical = raiseCritical;
  module.exports.setMidiTiming = setMidiTiming;
  module.exports.setUnitTiming = setUnitTiming;
  module.exports.loadMarkerMapForLayer = loadMarkerMapForLayer;
  module.exports.findMarkerSecs = findMarkerSecs;
  module.exports.clearMarkerCache = clearMarkerCache;
  // Import and expose restoreLayerToGlobals implementation moved to its own module
  restoreLayerToGlobals = require('./time/restoreLayerToGlobals');
  try { Function('f', 'this.restoreLayerToGlobals = f')(restoreLayerToGlobals); } catch (e) { /* swallow */ }
  module.exports.restoreLayerToGlobals = restoreLayerToGlobals;
} catch (e) { /* swallow export errors */ }
