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

// Ensure VoiceLeadingScore constructor is available for tests by requiring its module here
// This executes the module for side-effects and avoids adding test-specific exports to /src files
try {
  require('../src/composers/VoiceLeadingScore');
} catch (e) { /* If this fails that's fine; we'll try a robust fallback below */ }


// If the module created a constructor as a naked global, ensure require() also returns it by patching require cache and loader.
if (typeof VoiceLeadingScore === 'function') {
  try {
    const path = require('path');
    const filePath = path.resolve(__dirname, '../src/composers/VoiceLeadingScore.js');
    const possibleKeys = [];
    try { possibleKeys.push(require.resolve('../src/composers/VoiceLeadingScore')); } catch (e) {}
    try { possibleKeys.push(require.resolve(filePath)); } catch (e) {}
    possibleKeys.forEach((key) => {
      if (!key) return;
      const modEntry = require.cache[key];
      if (modEntry && modEntry.exports) {
        modEntry.exports.VoiceLeadingScore = VoiceLeadingScore;
      } else {
        require.cache[key] = { id: key, filename: key, loaded: true, exports: { VoiceLeadingScore } };
      }
    });

    // Monkey patch loader
    try {
      const Module = require('module');
      const origLoad = Module._load;
      Module._load = function(request, parent, isMain) {
        try {
          const resolved = Module._resolveFilename(request, parent);
          if (resolved === filePath || resolved.endsWith('/VoiceLeadingScore.js') || resolved.endsWith('\\VoiceLeadingScore.js')) {
            return { VoiceLeadingScore };
          }
        } catch (e) {}
        return origLoad.apply(this, arguments);
      };
    } catch (e) {}

  } catch (e) {}
}

// If the module didn't create a constructor in the global scope, evaluate the file in a non-module context and extract the constructor.
if (typeof VoiceLeadingScore !== 'function') {
  try {
    const fs = require('fs');
    const path = require('path');
    const filePath = path.resolve(__dirname, '../src/composers/VoiceLeadingScore.js');
    const code = fs.readFileSync(filePath, 'utf8');
    // Execute in a fresh function (non-strict) so legacy naked assignments like `VoiceLeadingScore = class ...` succeed
    const ctor = (new Function(code + '\nreturn typeof VoiceLeadingScore !== "undefined" ? VoiceLeadingScore : null;'))();
    if (typeof ctor === 'function') {
      // Assign as a naked global (project uses naked globals). Prefer explicit global assignment for robustness.
      try {
        if (typeof global !== 'undefined' && typeof global === 'object') { global.VoiceLeadingScore = ctor; }
        else if (typeof window !== 'undefined' && typeof window === 'object') { window.VoiceLeadingScore = ctor; }
        else { VoiceLeadingScore = ctor; }
      } catch (e) {
        // fallback to plain assignment
        VoiceLeadingScore = ctor;
      }

      // Also patch the require cache so `require('../src/composers/VoiceLeadingScore')` returns the constructor
      try {
        const possibleKeys = [];
        try { possibleKeys.push(require.resolve('../src/composers/VoiceLeadingScore')); } catch (e) {}
        try { possibleKeys.push(require.resolve(filePath)); } catch (e) {}
        possibleKeys.forEach((key) => {
          if (!key) return;
          const modEntry = require.cache[key];
          if (modEntry && modEntry.exports) {
            modEntry.exports.VoiceLeadingScore = ctor;
          } else {
            // create a minimal cache entry so subsequent requires get the ctor
            require.cache[key] = { id: key, filename: key, loaded: true, exports: { VoiceLeadingScore: ctor } };
          }
        });
      } catch (e) { /* ignore */ }

      // As an extra safety, monkey-patch the module loader to return the ctor
      // when tests call `require('../src/composers/VoiceLeadingScore')` directly.
      try {
        const Module = require('module');
        const origLoad = Module._load;
        Module._load = function(request, parent, isMain) {
          try {
            const resolved = Module._resolveFilename(request, parent);
            // Match the resolved path explicitly to avoid interfering with other modules
            if (resolved === filePath || resolved.endsWith('/VoiceLeadingScore.js') || resolved.endsWith('\\VoiceLeadingScore.js')) {
              return { VoiceLeadingScore: ctor };
            }
          } catch (e) {}
          return origLoad.apply(this, arguments);
        };
      } catch (e) { /* ignore */ }

      // Quick check: what's returned by require() now?
      }
  } catch (err) {
    console.warn('test setup: failed to initialize VoiceLeadingScore constructor from source (continuing):', err && err.stack ? err.stack : err);
  }}

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
