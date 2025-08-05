// Mode Composer - Fixed mode composition
import { MeasureComposer } from './baseComposer.js';

export class ModeComposer extends MeasureComposer {
  constructor(modeName, root, options = {}) {
    super(options);
    this.root = root;
    this.modeName = modeName;
    this.notes = this.getModeNotes(modeName, root);
  }

  getModeNotes(modeName, root) {
    // Mode patterns (intervals from root)
    const modePatterns = {
      'ionian': [0, 2, 4, 5, 7, 9, 11],      // Major scale
      'dorian': [0, 2, 3, 5, 7, 9, 10],      // Natural minor with raised 6th
      'phrygian': [0, 1, 3, 5, 7, 8, 10],    // Natural minor with lowered 2nd
      'lydian': [0, 2, 4, 6, 7, 9, 11],      // Major scale with raised 4th
      'mixolydian': [0, 2, 4, 5, 7, 9, 10],  // Major scale with lowered 7th
      'aeolian': [0, 2, 3, 5, 7, 8, 10],     // Natural minor scale
      'locrian': [0, 1, 3, 5, 6, 8, 10]      // Diminished scale
    };

    const allNotes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const pattern = modePatterns[modeName] || modePatterns['ionian'];
    const rootIndex = allNotes.indexOf(root);
    
    return pattern.map(interval => {
      const noteIndex = (rootIndex + interval) % 12;
      return allNotes[noteIndex];
    });
  }

  getNotes(octaveRange = null) {
    return this.generateNoteFromScale(octaveRange);
  }
}