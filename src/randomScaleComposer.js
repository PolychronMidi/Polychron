// Random Scale Composer - Generates random scales for composition
import { MeasureComposer } from './baseComposer.js';

export class RandomScaleComposer extends MeasureComposer {
  constructor(options = {}) {
    super(options);
    this.setupScales();
    this.setupNotes();
    this.generateNewScale();
  }

  setupScales() {
    // Common scale types
    this.allScales = [
      'major', 'minor', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'locrian',
      'harmonic minor', 'melodic minor', 'pentatonic major', 'pentatonic minor',
      'blues', 'whole tone', 'chromatic', 'diminished', 'augmented'
    ];
  }

  setupNotes() {
    this.allNotes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  }

  generateNewScale() {
    const randomScale = this._random.choice(this.allScales);
    const randomRoot = this._random.choice(this.allNotes);
    
    this.scaleName = randomScale;
    this.root = randomRoot;
    this.notes = this.getScaleNotes(randomScale, randomRoot);
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

    const pattern = scalePatterns[scaleName] || scalePatterns['major'];
    const rootIndex = this.allNotes.indexOf(root);
    
    return pattern.map(interval => {
      const noteIndex = (rootIndex + interval) % 12;
      return this.allNotes[noteIndex];
    });
  }

  getNotes(octaveRange = null) {
    const uniqueNotes = new Set();
    const voices = this.getVoices();
    const [minOctave, maxOctave] = octaveRange || this.getOctaveRange();
    const rootNote = this.notes[this._random.int(0, this.notes.length - 1)];
    
    let intervals = [];
    let fallback = false;
    
    try {
      const shift = this._random.int();
      switch (this._random.int(0, 2)) {
        case 0:
          intervals = [0, 2, 3 + shift, 6 - shift].map(interval => 
            Math.max(0, Math.min(interval * Math.round(this.notes.length / 7), this.notes.length - 1))
          );
          break;
        case 1:
          intervals = [0, 1, 3 + shift, 5 + shift].map(interval => 
            Math.max(0, Math.min(interval * Math.round(this.notes.length / 7), this.notes.length - 1))
          );
          break;
        default:
          intervals = Array.from({ length: this.notes.length }, (_, i) => i);
          fallback = true;
      }
      
      return intervals.slice(0, voices).map((interval, index) => {
        const noteIndex = (this.notes.indexOf(rootNote) + interval) % this.notes.length;
        let octave = this._random.int(minOctave, maxOctave);
        let note = this.noteToMidiNumber(this.notes[noteIndex], octave);
        
        while (uniqueNotes.has(note)) {
          octave = octave < maxOctave ? octave++ : 
                  octave > minOctave ? octave-- : 
                  octave < 8 ? octave++ : 
                  octave > 0 ? octave-- : 
                  (() => { return false; })();
          if (octave === false) break;
          note = this.noteToMidiNumber(this.notes[noteIndex], octave);
        }
        
        uniqueNotes.add(note);
        return { note };
      }).filter((noteObj, index, self) =>
        index === self.findIndex(n => n.note === noteObj.note)
      );
      
    } catch (error) {
      if (!fallback) {
        return this.getNotes(octaveRange);
      } else {
        console.warn(error.message);
        return this.getNotes(octaveRange);
      }
    }
  }

  // Override to regenerate scale each time
  x() {
    this.generateNewScale();
    return this.getNotes();
  }
}