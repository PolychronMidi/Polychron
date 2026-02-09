// ChordValues.js - small pure helpers for chord transformations

ChordValues = (function() {
  function invert(notes, inversion = 0) {
    if (!Array.isArray(notes)) throw new Error('ChordValues.invert: notes array required');
    const n = notes.slice();
    for (let i = 0; i < inversion; i++) {
      const note = n.shift();
      n.push(note + 12);
    }
    return n;
  }

  function distributeAcrossVoices(notes, voices = 4) {
    if (!Array.isArray(notes)) throw new Error('ChordValues.distributeAcrossVoices: notes array required');
    if (typeof voices !== 'number' || voices < 1) throw new Error('ChordValues.distributeAcrossVoices: voices must be >= 1');
    const out = new Array(voices).fill(null).map(() => []);
    for (let i = 0; i < notes.length; i++) {
      out[i % voices].push(notes[i]);
    }
    return out;
  }

  function chordToMidi(noteNames) {
    if (!Array.isArray(noteNames)) throw new Error('ChordValues.chordToMidi: noteNames array required');
    return noteNames.map(n => {
      if (typeof n === 'number') return n;
      const midi = getMidiValue ? getMidiValue(n) : null;
      if (midi === null || midi === undefined) throw new Error(`ChordValues.chordToMidi: cannot resolve MIDI for ${n}`);
      return midi;
    });
  }

  return { invert, distributeAcrossVoices, chordToMidi };
})();
