// @ts-check
// ChordComposer - Composes notes from chord progressions
// Using GenericComposer<Chord> base class with progression tracking

import GenericComposer from './GenericComposer.js';
import * as tonal from 'tonal';
import { allChords } from '../venue.js';
import { ri } from '../utils.js';
import m from '../utils.js';

/**
 * Composes notes from chord progressions.
 * Extends GenericComposer with progression tracking and direction support.
 * @extends GenericComposer<Chord>
 */
class ChordComposer extends GenericComposer<any> {
  progression: string[] | undefined;
  currentChordIndex: number;
  direction: string;
  _t: any;
  _ri: any;
  _allChords: string[] = [];
  _m: any;

  // deps is an optional injection point for tests (t, ri, allChords, m)
  constructor(progression: string[] = ['C'], deps?: { t?: any; ri?: any; allChords?: string[]; m?: any }) {
    super('chord', 'C');

    const t = (deps && deps.t) || tonal;
    const riLocal = (deps && deps.ri) || ri;
    const allChordsLocal = (deps && deps.allChords) || allChords;
    const mLocal = (deps && deps.m) || m;

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
        const chordData = t.Chord.get(chord);
        if (!chordData || !chordData.notes || chordData.notes.length === 0) {
          console.warn(`Invalid chord: ${chord}`);
          return false;
        }
        return true;
      } catch (_e) {
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
    const firstChordData = t.Chord.get(validProgression[0]);
    const firstRoot = firstChordData.tonic || 'C';
    this.root = firstRoot;

    // Set up chord-specific properties and instance dependency references
    this.progression = validProgression;
    this.currentChordIndex = 0;
    this.direction = 'R';
    this._t = t;
    this._ri = riLocal;
    this._allChords = allChordsLocal;
    this._m = mLocal;

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
    const chordData = this._t.Chord.get(currentChord);
    this.notes = chordData ? chordData.notes : ['C', 'E', 'G'];

    // Move to next chord based on direction
    if (direction === 'R') {
      this.currentChordIndex = (this.currentChordIndex + 1) % this.progression.length;
    } else if (direction === 'L') {
      this.currentChordIndex = (this.currentChordIndex - 1 + this.progression.length) % this.progression.length;
    } else if (direction === 'E') {
      this.currentChordIndex = this._ri(this.progression.length - 1);
    } else if (direction === 'J') {
      const jump = this._ri(-2, 2);
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
    const chordData = this._t.Chord.get(currentChord);
    this.notes = chordData ? chordData.notes : ['C', 'E', 'G'];

    // Move to next chord
    if (this.direction === 'R') {
      this.currentChordIndex = (this.currentChordIndex + 1) % this.progression.length;
    } else if (this.direction === 'L') {
      this.currentChordIndex = (this.currentChordIndex - 1 + this.progression.length) % this.progression.length;
    } else if (this.direction === 'E') {
      this.currentChordIndex = this._ri(this.progression.length - 1);
    } else if (this.direction === 'J') {
      const jump = this._ri(-2, 2);
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
  _ri: any;
  _allChords: string[];

  constructor(deps?: { ri?: any; allChords?: string[] }) {
    const riLocal = (deps && deps.ri) || ri;
    const allChordsLocal = (deps && deps.allChords) || allChords;

    const len = ri(2, 5);
    const progression: string[] = [];
    for (let i = 0; i < len; i++) {
      let chord;
      let attempts = 0;
      do {
        const index = riLocal(allChordsLocal.length - 1);
        chord = allChordsLocal[index];
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
    super(progression, deps);
    this._ri = riLocal;
    this._allChords = allChordsLocal;
  }

  regenerateProgression(): void {
    const riLocal = this._ri || ri;
    const allChordsLocal = this._allChords || allChords;
    const len = riLocal(2, 5);
    const progression: string[] = [];
    for (let i = 0; i < len; i++) {
      let chord;
      let attempts = 0;
      do {
        const index = riLocal(allChordsLocal.length - 1);
        chord = allChordsLocal[index];
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

export default ChordComposer;
export { ChordComposer, RandomChordComposer };
