// time.js - Timing engine with meter spoofing and dual-layer polyrhythm support.
// minimalist comments, details at: time.md

const { writeIndexTrace, writeDebugFile, appendToFile, writeFatal } = require('./logGate');
const m = Math;

// TimingCalculator moved to its own module to keep `time.js` smaller and more testable.
try { TimingCalculator = require('./time/TimingCalculator'); } catch (e) { /* swallow */ }

// Export TimingCalculator to test hooks and for other modules
// Use centralized test hooks instead of global mutation
const TEST = require('./test-hooks');
// One-time warning helper to avoid flooding logs with the same critical messages
const _polychron_warned = new Set();
function warnOnce(key, msg) {
  try {
    if (_polychron_warned.has(key)) return;
    _polychron_warned.add(key);
    // Gate warnings via logGate (debug category)
    try { writeDebugFile('warnings.ndjson', { key, msg }); } catch (e) { /* swallow */ }
  } catch (e) { /* swallow logging errors */ }
}

// Fail-fast critical handler: delegate to centralized postfix guard
function raiseCritical(key, msg, ctx = {}) {
  // Debug assist: log the key/msg when critical is raised (helps detect undefined messages)
  try { if (TEST && TEST.DEBUG) console.log('raiseCritical called', { key, msg }); } catch (e) { /* swallow */ }
  // Delegate to shared raiseCritical implementation so all modules write consistent diagnostics
  try {
    const guard = require('./postfixGuard');
    return guard.raiseCritical(key, msg, ctx);
  } catch (e) {
    // Fallback: if guard fails for some reason, ensure we still throw loudly
    try { writeFatal({ when: new Date().toISOString(), type: 'postfix-anti-pattern', severity: 'critical', key, msg, stack: (new Error()).stack, ctx }); } catch (_e) { /* swallow */ }
    throw new Error('CRITICAL: ' + msg);
  }
}
let timingCalculator = null;
let restoreLayerToGlobals;

/**
 * Compute MIDI-compatible meter and tempo sync factor.
 * Sets: midiMeter, midiMeterRatio, syncFactor, midiBPM, tpSec, tpMeasure, spMeasure.
 * @returns {number[]} MIDI meter as [numerator, denominator].
 */
getMidiTiming = () => {
  // Debug: log inputs when running tests to aid diagnosis
  try { if (TEST && TEST.DEBUG) console.log('getMidiTiming inputs', { BPM, PPQ, numerator, denominator }); } catch (e) { /* swallow */ }
  timingCalculator = new TimingCalculator({ bpm: BPM, ppq: PPQ, meter: [numerator, denominator] });
  ({ midiMeter, midiMeterRatio, meterRatio, syncFactor, midiBPM, tpSec, tpMeasure, spMeasure } = timingCalculator);
  try { if (TEST && TEST.DEBUG) console.log('getMidiTiming outputs', { midiMeter, midiMeterRatio, meterRatio, syncFactor, midiBPM, tpSec, tpMeasure, spMeasure }); } catch (e) { /* swallow */ }
  return midiMeter; // Return the midiMeter for testing
};

// Load TimingContext implementation from its own module to reduce file size and improve testability
try { TimingContext = require('./time/TimingContext'); } catch (e) { /* swallow */ }
// Load LayerManager module which sets global LM for tests and runtime (keeps legacy naked-global semantics)
try { require('./time/LayerManager'); } catch (e) { /* swallow */ }
/**
 * Write MIDI timing events to the active buffer.
 * Implemented in `src/time/setMidiTiming.js`.
 * @param {number} [tick] - MIDI tick position.
 */
setMidiTiming = (function () { try { return require('./time/setMidiTiming'); } catch (e) { return (typeof setMidiTiming === 'function') ? setMidiTiming : undefined; } })();
/**
 * Set timing variables for each unit level. Implemented in `src/time/setUnitTiming.js`.
 * @param {string} unitType - Unit type for timing calculation and logging.
 */
setUnitTiming = (function () { try { return require('./time/setUnitTiming'); } catch (e) { return (typeof setUnitTiming === 'function') ? setUnitTiming : undefined; } })();
/**
 * Compute phrase alignment between primary and poly meters in seconds.
 * Implemented in `src/time/getPolyrhythm.js`.
 * Exposed as a naked global for backward compatibility.
 */
getPolyrhythm = require('./time/getPolyrhythm');
try { Function('f', 'this.getPolyrhythm = f')(getPolyrhythm); } catch (e) { /* swallow */ }
try { module.exports.getPolyrhythm = getPolyrhythm; } catch (e) { /* swallow */ }

/**
 * Format seconds as MM:SS.ssss time string.
 * @param {number} seconds - Time in seconds.
 * @returns {string} Formatted time string (MM:SS.ssss).
 */
formatTime = (seconds) => {
  const minutes = m.floor(seconds / 60);
  seconds = (seconds % 60).toFixed(4).padStart(7, '0');
  return `${minutes}:${seconds}`;
};

// Marker map delegated to `src/time/markerMap.js` (imported directly)
const { _csvPathForLayer, loadMarkerMapForLayer, findMarkerSecs, clearMarkerCache } = require('./time/markerMap');



// Export public API for programmatic imports and testing
try {
  module.exports = module.exports || {};
  module.exports.TimingCalculator = TimingCalculator;
  module.exports.getMidiTiming = getMidiTiming;
  module.exports.setMidiTiming = setMidiTiming;
  module.exports.setUnitTiming = setUnitTiming;
  module.exports.loadMarkerMapForLayer = loadMarkerMapForLayer;
  module.exports.findMarkerSecs = findMarkerSecs;
  module.exports.clearMarkerCache = clearMarkerCache;
  // Import and expose restoreLayerToGlobals implementation moved to its own module
  try { restoreLayerToGlobals = require('./time/restoreLayerToGlobals'); try { Function('f', 'this.restoreLayerToGlobals = f')(restoreLayerToGlobals); } catch (e) { /* swallow */ } } catch (e) { /* swallow */ }
  module.exports.restoreLayerToGlobals = restoreLayerToGlobals;
} catch (e) { /* swallow export errors */ }
