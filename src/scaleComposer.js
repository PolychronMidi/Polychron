// Scale Composer - Fixed scale composition
import { MeasureComposer } from './baseComposer.js';

export class ScaleComposer extends MeasureComposer {
  constructor(scaleName, root, options = {}) {
    super(options);
    this.root = root;
    this.scaleName = scaleName;
    this.notes = this.getScaleNotes(scaleName, root);
  }

  getScaleNotes(scaleName, root) {
    // Simplified scale generation - in real implementation would use Tonal.js
    const scalePatterns = {
      'major': [0, 2, 4, 5, 7, 9, 11],
      'minor': [0, 2, 3, 5, 7, 8, 10],
      'dorian': [0, 2, 3, 5, 7, 9, 10],
      'phrygian': [0, 1, 3, 5, 7, 8, 10],
      'lydian': [0, 2, 4, 6, 7, 9, 11],
      'mixolydian': [0, 2, 4, 5, 7, 9, 10],
      'locrian': [0, 1, 3, 5, 6, 8, 10],
      'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
      'melodic minor': [0, 2, 3, 5, 7, 9, 11],
      'pentatonic major': [0, 2, 4, 7, 9],
      'pentatonic minor': [0, 3, 5, 7, 10],
      'blues': [0, 3, 5, 6, 7, 10],
      'whole tone': [0, 2, 4, 6, 8, 10],
      'chromatic': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      'diminished': [0, 2, 3, 5, 6, 8, 9, 11],
      'augmented': [0, 3, 4, 7, 8, 11]
    };

    const allNotes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const pattern = scalePatterns[scaleName] || scalePatterns['major'];
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