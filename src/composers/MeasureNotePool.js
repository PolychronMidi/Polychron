// MeasureNotePool.js - note pool builder for MeasureComposer
const V = validator.create('measureNotePool');

/**
 * Builds a note pool across octaves using interval selection.
 */
MeasureNotePool = {
  /**
   * Build note pool from scale notes and intervals
   * @param {string[]} notes - Scale note names
   * @param {number[]} intervals - Selected scale degree intervals
   * @param {number[]} octaveRange - [minOctave, maxOctave]
   * @param {string} rootNote - Root note name
   * @returns {{note: number}[]} Array of note objects
   */
  buildNotePool(notes, intervals, octaveRange, rootNote) {
    V.assertArray(notes, 'notes');
    V.assertArray(intervals, 'intervals');
    V.assertArray(octaveRange, 'octaveRange');
    if (notes.length === 0) {
      throw new TypeError('notes must be a non-empty array');
    }
    if (intervals.length === 0) {
      throw new TypeError('intervals must be a non-empty array');
    }
    if (octaveRange.length < 2) {
      throw new TypeError('octaveRange must be an array with two elements: [minOctave, maxOctave]');
    }

    const minOctave = m.min(octaveRange[0], octaveRange[1]);
    const maxOctave = m.max(octaveRange[0], octaveRange[1]);
    const rootIndex = notes.indexOf(rootNote);
    if (rootIndex === -1) return [];

    const uniqueNotes = new Set();
    const notesOut = [];

    for (const interval of intervals) {
      const noteIndex = (rootIndex + interval) % notes.length;
      const noteName = notes[noteIndex];
      if (!noteName) continue; // Skip if note name undefined
      const chroma = t.Note.chroma(noteName);
      if (typeof chroma !== 'number' || !Number.isFinite(chroma)) continue; // Skip invalid chroma
      for (let octave = minOctave; octave <= maxOctave; octave++) {
        const note = chroma + 12 * octave;
        if (!uniqueNotes.has(note)) {
          uniqueNotes.add(note);
          notesOut.push({ note });
        }
      }
    }

    return notesOut;
  }
};
