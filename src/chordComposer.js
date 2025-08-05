// Chord Composer - Fixed chord progression composition
import { MeasureComposer } from './baseComposer.js';

export class ChordComposer extends MeasureComposer {
  constructor(progression, options = {}) {
    super(options);
    this.setupProgression(progression);
    this.currentChordIndex = 0;
  }

  setupProgression(progression) {
    const validatedProgression = progression.filter(chordSymbol => {
      if (!this.isValidChord(chordSymbol)) {
        console.warn(`Invalid chord symbol: ${chordSymbol}`);
        return false;
      }
      return true;
    });

    if (validatedProgression.length === 0) {
      console.warn('No valid chords in progression, using default');
      this.progression = [this.parseChord('C'), this.parseChord('Am'), this.parseChord('F'), this.parseChord('G')];
    } else {
      this.progression = validatedProgression.map(chordSymbol => this.parseChord(chordSymbol));
    }
  }

  isValidChord(chordSymbol) {
    const validChords = [
      'C', 'Cmaj7', 'C7', 'Cm', 'Cm7',
      'D', 'Dmaj7', 'D7', 'Dm', 'Dm7',
      'E', 'Emaj7', 'E7', 'Em', 'Em7',
      'F', 'Fmaj7', 'F7', 'Fm', 'Fm7',
      'G', 'Gmaj7', 'G7', 'Gm', 'Gm7',
      'A', 'Amaj7', 'A7', 'Am', 'Am7',
      'B', 'Bmaj7', 'B7', 'Bm', 'Bm7', 'Bm7b5', 'Bdim',
      'Bb', 'Bbmaj7', 'Bb7', 'Bbm', 'Bbm7',
      'Ab', 'Abmaj7', 'Ab7', 'Abm', 'Abm7',
      'Eb', 'Ebmaj7', 'Eb7', 'Ebm', 'Ebm7'
    ];
    return validChords.includes(chordSymbol);
  }

  parseChord(chordSymbol) {
    // Simplified chord parsing - in real implementation would use Tonal.js
    const chordPatterns = {
      // Major chords
      'C': ['C', 'E', 'G'],
      'Cmaj7': ['C', 'E', 'G', 'B'],
      'C7': ['C', 'E', 'G', 'Bb'],
      'Cm': ['C', 'Eb', 'G'],
      'Cm7': ['C', 'Eb', 'G', 'Bb'],
      'D': ['D', 'F#', 'A'],
      'Dmaj7': ['D', 'F#', 'A', 'C#'],
      'D7': ['D', 'F#', 'A', 'C'],
      'Dm': ['D', 'F', 'A'],
      'Dm7': ['D', 'F', 'A', 'C'],
      'E': ['E', 'G#', 'B'],
      'Emaj7': ['E', 'G#', 'B', 'D#'],
      'E7': ['E', 'G#', 'B', 'D'],
      'Em': ['E', 'G', 'B'],
      'Em7': ['E', 'G', 'B', 'D'],
      'F': ['F', 'A', 'C'],
      'Fmaj7': ['F', 'A', 'C', 'E'],
      'F7': ['F', 'A', 'C', 'Eb'],
      'Fm': ['F', 'Ab', 'C'],
      'Fm7': ['F', 'Ab', 'C', 'Eb'],
      'G': ['G', 'B', 'D'],
      'Gmaj7': ['G', 'B', 'D', 'F#'],
      'G7': ['G', 'B', 'D', 'F'],
      'Gm': ['G', 'Bb', 'D'],
      'Gm7': ['G', 'Bb', 'D', 'F'],
      'A': ['A', 'C#', 'E'],
      'Amaj7': ['A', 'C#', 'E', 'G#'],
      'A7': ['A', 'C#', 'E', 'G'],
      'Am': ['A', 'C', 'E'],
      'Am7': ['A', 'C', 'E', 'G'],
      'B': ['B', 'D#', 'F#'],
      'Bmaj7': ['B', 'D#', 'F#', 'A#'],
      'B7': ['B', 'D#', 'F#', 'A'],
      'Bm': ['B', 'D', 'F#'],
      'Bm7': ['B', 'D', 'F#', 'A'],
      'Bm7b5': ['B', 'D', 'F', 'A'],
      'Bdim': ['B', 'D', 'F'],
      'Bb': ['Bb', 'D', 'F'],
      'Bbmaj7': ['Bb', 'D', 'F', 'A'],
      'Bb7': ['Bb', 'D', 'F', 'Ab'],
      'Bbm': ['Bb', 'Db', 'F'],
      'Bbm7': ['Bb', 'Db', 'F', 'Ab'],
      'Ab': ['Ab', 'C', 'Eb'],
      'Abmaj7': ['Ab', 'C', 'Eb', 'G'],
      'Ab7': ['Ab', 'C', 'Eb', 'Gb'],
      'Abm': ['Ab', 'Cb', 'Eb'],
      'Abm7': ['Ab', 'Cb', 'Eb', 'Gb'],
      'Eb': ['Eb', 'G', 'Bb'],
      'Ebmaj7': ['Eb', 'G', 'Bb', 'D'],
      'Eb7': ['Eb', 'G', 'Bb', 'Db'],
      'Ebm': ['Eb', 'Gb', 'Bb'],
      'Ebm7': ['Eb', 'Gb', 'Bb', 'Db']
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
    
    // Progress through chord progression based on measure
    if (this.random.float() < 0.05) {
      this.progressChord();
    }
    
    const currentChord = this.progression[this.currentChordIndex];
    this.notes = currentChord.notes;
    
    const resultNotes = [];
    const uniqueNotes = new Set();
    
    for (let i = 0; i < Math.min(voices, this.notes.length); i++) {
      const noteIndex = i % this.notes.length;
      const noteName = this.notes[noteIndex];
      let octave = this.random.int(minOctave, maxOctave);
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
    const direction = this.random.choice(['R', 'L', 'E', '?']);
    let next;
    
    switch (direction.toUpperCase()) {
      case 'R': next = 1; break;
      case 'L': next = -1; break;
      case 'E': next = this.random.boolean() ? 1 : -1; break;
      case '?': next = this.random.int(-2, 2); break;
      default: next = 1;
    }
    
    this.currentChordIndex = (this.currentChordIndex + next + this.progression.length) % this.progression.length;
  }
}