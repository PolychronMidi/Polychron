// Random Mode Composer - Generates random modal compositions
import { MeasureComposer } from './baseComposer.js';

export class RandomModeComposer extends MeasureComposer {
  constructor(options = {}) {
    super(options);
    this.setupModes();
    this.generateNewMode();
  }

  setupModes() {
    this.allModes = [
      'C ionian', 'D dorian', 'E phrygian', 'F lydian', 'G mixolydian', 'A aeolian', 'B locrian',
      'C# ionian', 'D# dorian', 'F# phrygian', 'G# lydian', 'A# mixolydian', 'C aeolian', 'D locrian',
      'Db ionian', 'Eb dorian', 'Gb phrygian', 'Ab lydian', 'Bb mixolydian', 'Db aeolian', 'Eb locrian'
    ];
  }

  generateNewMode() {
    const randomMode = this._random.choice(this.allModes);
    const [root, modeName] = randomMode.split(' ');
    
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

  // Override to regenerate mode each time
  x() {
    this.generateNewMode();
    return this.getNotes();
  }
}