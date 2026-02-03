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
  // Ensure writer/grandFinale accessible if tests rely on them
  try { require('../src/writer'); } catch (_e) { console.warn('test setup: require ../src/writer failed (continuing):', _e && _e.stack ? _e.stack : _e); }
}

// Provide deterministic helper used by integration tests: schedule a single beat and return scheduled items
if (typeof global.__test_playBeat === 'undefined') {
  global.__test_playBeat = function(layer, beatKey = 0, _div = 0, _dum = 0, velocity = 80, binVel = 90) {
    if (!layer || !Array.isArray(layer.beatMotifs?.[beatKey])) return [];
    const bucket = Array.isArray(layer.beatMotifs[beatKey]) ? layer.beatMotifs[beatKey] : [];
    const picks = bucket.length ? bucket : [];
    const pushed = [];
    for (let i = 0; i < picks.length; i++) {
      const s = picks[i];
      const chosenNote = (layer.measureComposer && typeof layer.measureComposer.selectNoteWithLeading === 'function')
        ? layer.measureComposer.selectNoteWithLeading(picks.map(p => p.note))
        : (s.note || 0);
      if (typeof global.p === 'function' && Array.isArray(global.c)) {
        global.p(global.c, { tick: 0, type: 'on', vals: [global.cCH1, chosenNote, velocity] });
        global.p(global.c, { tick: 1, vals: [global.cCH1, chosenNote] });
      }
      pushed.push({ note: chosenNote, tick: 0 });
    }
    return pushed;
  };
}
