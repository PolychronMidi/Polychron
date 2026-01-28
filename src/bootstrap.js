// bootstrap.js - Small initialization to ensure minimal globals exist when running scripts directly.
try { __POLYCHRON_TEST__ = __POLYCHRON_TEST__ || {}; } catch (e) { /* swallow */ }

// Ensure Tonal is available globally as `t` for modules that expect it
try {
  if (typeof t === 'undefined' || !t) {
    try { t = require('tonal'); } catch (e) { t = (__POLYCHRON_TEST__ && __POLYCHRON_TEST__.t) || undefined; }
  }
} catch (e) { /* swallow */ }

// Compute fallback musical lists when venue.js isn't loaded
try {
  if (typeof allNotes === 'undefined' || !Array.isArray(allNotes)) {
    try { allNotes = t && t.Scale ? t.Scale.get('C chromatic').notes.map(n=>t.Note.enharmonic(t.Note.get(n))) : ['C','D','E','F','G','A','B']; } catch (e) { allNotes = ['C','D','E','F','G','A','B']; }
  }
  if (typeof allScales === 'undefined' || !Array.isArray(allScales)) {
    try { allScales = t && t.Scale && typeof t.Scale.names === 'function' ? t.Scale.names().filter(n=>{ try { return t.Scale.get('C '+n).notes.length > 0; } catch (e) { return false; } }) : ['major','minor','chromatic']; } catch (e) { allScales = ['major','minor','chromatic']; }
  }
  if (typeof allChords === 'undefined' || !Array.isArray(allChords)) {
    try {
      const _set = new Set();
      if (t && t.ChordType && t.Chord) {
        t.ChordType.all().forEach(ct => { (allNotes||[]).forEach(root => { try { const chord = t.Chord.get(`${root} ${ct.name}`); if (!chord.empty && chord.symbol) _set.add(chord.symbol); } catch (e) { /* swallow per-root */ } }); });
      }
      allChords = Array.from(_set);
    } catch (e) { allChords = []; }
  }
  if (typeof allModes === 'undefined' || !Array.isArray(allModes)) {
    try {
      const _m = new Set();
      if (t && t.Mode) {
        t.Mode.all().forEach(mode => { (allNotes||[]).forEach(root => { _m.add(`${root} ${mode.name}`); }); });
      }
      allModes = Array.from(_m);
    } catch (e) { allModes = []; }
  }
} catch (e) { /* swallow */ }
