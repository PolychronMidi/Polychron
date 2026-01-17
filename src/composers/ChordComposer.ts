// @ts-check
// ChordComposer - Composes notes from chord progressions
// Using GenericComposer<Chord> base class with progression tracking

import GenericComposer from './GenericComposer.js';

/**
 * Composes notes from chord progressions.
 * Extends GenericComposer with progression tracking and direction support.
 * @extends GenericComposer<Chord>
 */
class ChordComposer extends GenericComposer {
  progression: string[] | undefined;
  currentChordIndex: number;
  direction: string;

  constructor(progression: string[] = ['C']) {
    super('chord', 'C');
    
    // Normalize chord names (C -> Cmajor)
    const normalizedProgression = progression.map(chord => {
      // If it's just a note name (single letter possibly with sharp/flat), make it a major chord
      if (/^[A-G][b#]?$/.test(chord)) {
        return chord + 'major';
      }
      return chord;
    });

    // Filter invalid chords
    const validProgression = normalizedProgression.filter(chord => {
      try {
        const chordData = (globalThis as any).t.Chord.get(chord);
        if (!chordData || !chordData.notes || chordData.notes.length === 0) {
          console.warn(`Invalid chord: ${chord}`);
          return false;
        }
        return true;
      } catch (e) {
        console.warn(`Invalid chord: ${chord}`);
        return false;
      }
    });

    if (validProgression.length === 0) {
      console.warn('No valid chords in progression');
      this.progression = undefined;
      this.currentChordIndex = 0;
      this.direction = 'R';
      this.notes = ['C', 'E', 'G'];
      return;
    }

    // Get the root of the first chord
    const firstChordData = (globalThis as any).t.Chord.get(validProgression[0]);
    const firstRoot = firstChordData.tonic || 'C';
    this.root = firstRoot;

    // Set up chord-specific properties
    this.progression = validProgression;
    this.currentChordIndex = 0;
    this.direction = 'R';

    // Set initial notes from first chord
    this.setChordProgression(validProgression, 'R');
  }

  setChordProgression(progression: string[], direction: string = 'R'): void {
    if (!progression || progression.length === 0) {
      this.notes = ['C', 'E', 'G'];
      return;
    }

    // Normalize chord names - only if needed
    const normalizedProgression = Array.isArray(progression) ? progression.map(chord => {
      if (typeof chord === 'string' && /^[A-G][b#]?$/.test(chord)) {
        return chord + 'major';
      }
      return typeof chord === 'string' ? chord : String(chord);
    }) : [typeof progression[0] === 'string' ? progression[0] : String(progression[0])];

    this.progression = normalizedProgression;
    this.direction = direction;

    // Set initial chord
    const currentChord = this.progression[this.currentChordIndex];
    const chordData = (globalThis as any).t.Chord.get(currentChord);
    this.notes = chordData ? chordData.notes : ['C', 'E', 'G'];

    // Move to next chord based on direction
    if (direction === 'R') {
      this.currentChordIndex = (this.currentChordIndex + 1) % this.progression.length;
    } else if (direction === 'L') {
      this.currentChordIndex = (this.currentChordIndex - 1 + this.progression.length) % this.progression.length;
    } else if (direction === 'E') {
      this.currentChordIndex = (globalThis as any).ri(this.progression.length - 1);
    } else if (direction === 'J') {
      const jump = (globalThis as any).ri(-2, 2);
      this.currentChordIndex = (this.currentChordIndex + jump + this.progression.length) % this.progression.length;
    }
  }

  itemSet(progression: string[] | string, direction: string = 'R'): void {
    // Handle both string (from parent) and array (chord progression)
    if (typeof progression === 'string') {
      // Fallback - shouldn't normally be called with string for ChordComposer
      return;
    }
    this.setChordProgression(progression, direction);
  }



  x(): any[] {
    if (!this.progression || this.progression.length === 0) {
      return this.getNotes();
    }
    const currentChord = this.progression[this.currentChordIndex];
    const chordData = (globalThis as any).t.Chord.get(currentChord);
    this.notes = chordData ? chordData.notes : ['C', 'E', 'G'];

    // Move to next chord
    if (this.direction === 'R') {
      this.currentChordIndex = (this.currentChordIndex + 1) % this.progression.length;
    } else if (this.direction === 'L') {
      this.currentChordIndex = (this.currentChordIndex - 1 + this.progression.length) % this.progression.length;
    } else if (this.direction === 'E') {
      this.currentChordIndex = (globalThis as any).ri(this.progression.length - 1);
    } else if (this.direction === 'J') {
      const jump = (globalThis as any).ri(-2, 2);
      this.currentChordIndex = (this.currentChordIndex + jump + this.progression.length) % this.progression.length;
    }

    return this.getNotes();
  }
}

/**
 * Random chord progression composer.
 * Generates random progressions and regenerates on each x() call.
 * @extends ChordComposer
 */
class RandomChordComposer extends ChordComposer {
  constructor() {
    const len = (globalThis as any).ri(2, 5);
    const progression: string[] = [];
    for (let i = 0; i < len; i++) {
      let chord;
      let attempts = 0;
      do {
        const index = (globalThis as any).ri((globalThis as any).allChords.length - 1);
        chord = (globalThis as any).allChords[index];
        attempts++;
        // Give up after 10 attempts and use a fallback
        if (attempts > 10) {
          chord = 'Cmaj';
          break;
        }
      } while (!chord || typeof chord !== 'string' || chord.trim() === '');

      if (chord && typeof chord === 'string' && chord.trim() !== '') {
        progression.push(chord);
      }
    }
    // Ensure we have at least one chord
    if (progression.length === 0) {
      progression.push('Cmaj');
    }
    super(progression);
  }

  regenerateProgression(): void {
    const len = (globalThis as any).ri(2, 5);
    const progression: string[] = [];
    for (let i = 0; i < len; i++) {
      let chord;
      let attempts = 0;
      do {
        const index = (globalThis as any).ri((globalThis as any).allChords.length - 1);
        chord = (globalThis as any).allChords[index];
        attempts++;
        // Give up after 10 attempts and use a fallback
        if (attempts > 10) {
          chord = 'Cmaj';
          break;
        }
      } while (!chord || typeof chord !== 'string' || chord.trim() === '');

      if (chord && typeof chord === 'string' && chord.trim() !== '') {
        progression.push(chord);
      }
    }
    // Ensure we have at least one chord
    if (progression.length === 0) {
      progression.push('Cmaj');
    }
    // Reset chord index to 0 before setting new progression to avoid out-of-bounds access
    this.currentChordIndex = 0;
    this.setChordProgression(progression, 'R');
  }

  x(): any[] {
    this.regenerateProgression();
    return ChordComposer.prototype.x.call(this);
  }
}

// Export to global scope
(globalThis as any).ChordComposer = ChordComposer;
(globalThis as any).RandomChordComposer = RandomChordComposer;
export default ChordComposer;
export { ChordComposer, RandomChordComposer };
