// Random Chord Composer - Generates random chord progressions
import { MeasureComposer } from './baseComposer.js';

export class RandomChordComposer extends MeasureComposer {
  constructor(options = {}) {
    super(options);
    this.setupChords();
    this.generateNewProgression();
    this.currentChordIndex = 0;
  }

  setupChords() {
    this.allChords = [
      'Cmaj7', 'Dm7', 'Em7', 'Fmaj7', 'G7', 'Am7', 'Bm7b5',
      'C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim',
      'C7', 'D7', 'E7', 'F7', 'G7', 'A7', 'B7',
      'Cm', 'Dm', 'Ebmaj7', 'Fm', 'Gm', 'Ab', 'Bb'
    ];
  }

  generateNewProgression() {
    const progressionLength = this._random.int(2, 5);
    const randomProgression = [];
    
    for (let i = 0; i < progressionLength; i++) {
      const randomChord = this._random.choice(this.allChords);
      randomProgression.push(randomChord);
    }
    
    this.progression = randomProgression.map(chordSymbol => this.parseChord(chordSymbol));
    this.currentChordIndex = 0;
  }

  parseChord(chordSymbol) {
    // Simplified chord parsing - in real implementation would use Tonal.js
    const chordPatterns = {
      // Major chords
      'C': ['C', 'E', 'G'],
      'Cmaj7': ['C', 'E', 'G', 'B'],
      'C7': ['C', 'E', 'G', 'Bb'],
      'D': ['D', 'F#', 'A'],
      'Dm': ['D', 'F', 'A'],
      'Dm7': ['D', 'F', 'A', 'C'],
      'D7': ['D', 'F#', 'A', 'C'],
      'E': ['E', 'G#', 'B'],
      'Em': ['E', 'G', 'B'],
      'Em7': ['E', 'G', 'B', 'D'],
      'E7': ['E', 'G#', 'B', 'D'],
      'F': ['F', 'A', 'C'],
      'Fm': ['F', 'Ab', 'C'],
      'Fmaj7': ['F', 'A', 'C', 'E'],
      'F7': ['F', 'A', 'C', 'Eb'],
      'G': ['G', 'B', 'D'],
      'Gm': ['G', 'Bb', 'D'],
      'G7': ['G', 'B', 'D', 'F'],
      'A': ['A', 'C#', 'E'],
      'Am': ['A', 'C', 'E'],
      'Am7': ['A', 'C', 'E', 'G'],
      'A7': ['A', 'C#', 'E', 'G'],
      'B': ['B', 'D#', 'F#'],
      'Bm7b5': ['B', 'D', 'F', 'A'],
      'B7': ['B', 'D#', 'F#', 'A'],
      'Bdim': ['B', 'D', 'F'],
      'Bb': ['Bb', 'D', 'F'],
      'Ab': ['Ab', 'C', 'Eb'],
      'Ebmaj7': ['Eb', 'G', 'Bb', 'D'],
      'Cm': ['C', 'Eb', 'G']
    };

    const notes = chordPatterns[chordSymbol] || chordPatterns['C'];
    return {
      symbol: chordSymbol,
      notes: notes
    };
  }

  getNotes(octaveRange = null) {
    const [minOctave, maxOctave] = octaveRange || this.getOctaveRange();
    const voices = this.getVoices();
    
    // Progress through chord progression
    if (this._random.float() < 0.05) {
      this.progressChord();
    }
    
    const currentChord = this.progression[this.currentChordIndex];
    const chordNotes = currentChord.notes;
    
    const resultNotes = [];
    const uniqueNotes = new Set();
    
    for (let i = 0; i < Math.min(voices, chordNotes.length); i++) {
      const noteIndex = i % chordNotes.length;
      const noteName = chordNotes[noteIndex];
      let octave = this._random.int(minOctave, maxOctave);
      let midiNote = this.noteToMidiNumber(noteName, octave);
      
      // Avoid duplicate notes
      while (uniqueNotes.has(midiNote) && octave <= maxOctave) {
        octave++;
        midiNote = this.noteToMidiNumber(noteName, octave);
      }
      
      if (octave <= maxOctave) {
        uniqueNotes.add(midiNote);
        resultNotes.push({ note: midiNote });
      }
    }
    
    return resultNotes;
  }

  progressChord() {
    const direction = this._random.choice(['R', 'L', 'E', '?']);
    let next;
    
    switch (direction.toUpperCase()) {
      case 'R': next = 1; break;
      case 'L': next = -1; break;
      case 'E': next = this._random.boolean() ? 1 : -1; break;
      case '?': next = this._random.int(-2, 2); break;
      default: next = 1;
    }
    
    this.currentChordIndex = (this.currentChordIndex + next + this.progression.length) % this.progression.length;
  }

  // Override to regenerate progression each time
  x() {
    this.generateNewProgression();
    return this.getNotes();
  }
}