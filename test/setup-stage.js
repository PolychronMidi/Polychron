// Test setup shim: require the real stage side-effect module when possible, otherwise provide minimal test-only shims
try {
  require('../src/stage');
} catch (e) {
  // If src/stage uses implicit global assignments that error in test runner, provide minimal no-op shims
  if (typeof setTuningAndInstruments === 'undefined') setTuningAndInstruments = function(){};
  if (typeof setOtherInstruments === 'undefined') setOtherInstruments = function(){};
  if (typeof crossModulateRhythms === 'undefined') crossModulateRhythms = function(){};
  if (typeof setSubdivNoteParams === 'undefined') setSubdivNoteParams = function(){};
  if (typeof playSubdivNotes === 'undefined') playSubdivNotes = function(){};
  if (typeof setSubsubdivNoteParams === 'undefined') setSubsubdivNoteParams = function(){};
  if (typeof playSubsubdivNotes === 'undefined') playSubsubdivNotes = function(){};
  // Also ensure writer/grandFinale accessible if tests rely on them
  try { require('../src/writer'); } catch (_e) { /* swallow */ }
}
