// Aggregated entry point for the src/time modules.
// Allows `require('./time')` to pull in the collection of timing utilities
// and preserve the previous convenience of a single-folder import.

// LayerManager intentionally sets the LM naked global when required
require('./LayerManager');
require('./midiTiming');
require('./setUnitTiming');
require('./getPolyrhythm');

// Debug helpers that were previously reachable via time.js
require('../debug/formatTime');

// Backwards-compatibility: timing modules restore globals themselves (module.exports removed)


// Also export a default assignment for earlier `require('../src/time')` usages
/* module.exports intentionally removed; timing modules restore globals themselves */
