// chordValues.js - small pure helpers for chord transformations

chordValues = (function() {
  /**
   * Invert a chord (rotate notes upward by octaves).
   * @param {number[]} notes
   * @param {number} [inversion]
   * @returns {number[]}
   */
  function invert(notes, inversion = 0) {
    if (!Array.isArray(notes)) throw new Error('chordValues.invert: notes array required');
    const n = /** @type {number[]} */ (notes.slice());
    for (let i = 0; i < inversion; i++) {
      const note = /** @type {number} */ (n.shift());
      n.push(note + 12);
    }
    return n;
  }

  /**
   * Split chord tones across a fixed number of voices.
   * @param {number[]} notes
   * @param {number} [voices]
   * @returns {number[][]}
   */
  function distributeAcrossVoices(notes, voices = 4) {
    if (!Array.isArray(notes)) throw new Error('chordValues.distributeAcrossVoices: notes array required');
    if (typeof voices !== 'number' || voices < 1) throw new Error('chordValues.distributeAcrossVoices: voices must be >= 1');
    const out = /** @type {number[][]} */ (new Array(voices).fill(null).map(() => []));
    for (let i = 0; i < notes.length; i++) {
      out[i % voices].push(notes[i]);
    }
    return out;
  }

  /**
   * Convert an array of note names or MIDI numbers to MIDI numbers.
   * @param {(string|number)[]} noteNames
   * @returns {number[]}
   */
  function chordToMidi(noteNames) {
    if (!Array.isArray(noteNames)) throw new Error('chordValues.chordToMidi: noteNames array required');
    return noteNames.map(n => {
      if (typeof n === 'number') return n;
      const midi = getMidiValue ? getMidiValue(n) : null;
      if (midi === null || midi === undefined) throw new Error(`chordValues.chordToMidi: cannot resolve MIDI for ${n}`);
      return midi;
    });
  }

  return { invert, distributeAcrossVoices, chordToMidi };
})();
