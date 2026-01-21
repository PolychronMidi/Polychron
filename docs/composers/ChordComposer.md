# ChordComposer.ts - Progression-Aware Harmonic Composer

> **Status**: Core Composer  
> **Dependencies**: GenericComposer.ts, Tonal Chord, global chord pools


## Overview

`ChordComposer.ts` generates chord tones from a progression, supporting normalization, validation, and directional traversal. A random variant regenerates a new progression on each tick.

**Core Responsibilities:**
- Normalize and validate chord progressions (adds major suffix for bare roots)
- Track direction (`R`, `L`, `E`, `J`) and current chord index
- Provide fallback notes when progressions are invalid
- Random variant to rebuild progressions per call

## Architecture Role

- Registered as `chords` in ComposerRegistry defaults for harmony generation
- Supplies chord tones that MeasureComposer converts to MIDI register choices

---

## API

### `class ChordComposer`

Progression-based chord tone composer.

<!-- BEGIN: snippet:ChordComposer -->

```typescript
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
    const ri = (deps && deps.ri) || g.ri;
    const allChordsLocal = (deps && deps.allChords) || allChords;
    const m = (deps && deps.m) || g.m;

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
    const firstChordData = t.Chord.get(validProgression[0]);
    const firstRoot = firstChordData.tonic || 'C';
    this.root = firstRoot;

    // Set up chord-specific properties and instance dependency references
    this.progression = validProgression;
    this.currentChordIndex = 0;
    this.direction = 'R';
    this._t = t;
    this._ri = ri;
    this._allChords = allChordsLocal;
    this._m = m;

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
```

<!-- END: snippet:ChordComposer -->

#### `setChordProgression(progression, direction = 'R')`

Normalize/validate chords, set notes, and advance index based on direction.

<!-- BEGIN: snippet:ChordComposer_setChordProgression -->

```typescript
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
```

<!-- END: snippet:ChordComposer_setChordProgression -->

#### `itemSet(progression, direction = 'R')`

Adapter for GenericComposer; forwards to `setChordProgression` when given an array.

<!-- BEGIN: snippet:ChordComposer_itemSet -->

```typescript
itemSet(progression: string[] | string, direction: string = 'R'): void {
    // Handle both string (from parent) and array (chord progression)
    if (typeof progression === 'string') {
      // Fallback - shouldn't normally be called with string for ChordComposer
      return;
    }
    this.setChordProgression(progression, direction);
  }
```

<!-- END: snippet:ChordComposer_itemSet -->

#### `x()`

Emit current chord notes then advance index according to direction.

<!-- BEGIN: snippet:ChordComposer_x -->

```typescript
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
```

<!-- END: snippet:ChordComposer_x -->

### `class RandomChordComposer`

Randomly generates a progression each tick and composes from it.

<!-- BEGIN: snippet:RandomChordComposer -->

```typescript
class RandomChordComposer extends ChordComposer {
  _ri: any;
  _allChords: string[];

  constructor(deps?: { ri?: any; allChords?: string[] }) {
    const ri = (deps && deps.ri) || g.ri;
    const allChords = (deps && deps.allChords) || g.allChords;

    const len = ri(2, 5);
    const progression: string[] = [];
    for (let i = 0; i < len; i++) {
      let chord;
      let attempts = 0;
      do {
        const index = ri(allChords.length - 1);
        chord = allChords[index];
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
    this._ri = ri;
    this._allChords = allChords;
  }

  regenerateProgression(): void {
    const ri = this._ri || g.ri;
    const allChords = this._allChords || allChords;
    const len = ri(2, 5);
    const progression: string[] = [];
    for (let i = 0; i < len; i++) {
      let chord;
      let attempts = 0;
      do {
        const index = ri(allChords.length - 1);
        chord = allChords[index];
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
```

<!-- END: snippet:RandomChordComposer -->

#### `regenerateProgression()` / `x()`

Build a new random progression, reset index, compose, and advance.

<!-- BEGIN: snippet:RandomChordComposer_regenerateProgression -->

```typescript
regenerateProgression(): void {
    const ri = this._ri || g.ri;
    const allChords = this._allChords || allChords;
    const len = ri(2, 5);
    const progression: string[] = [];
    for (let i = 0; i < len; i++) {
      let chord;
      let attempts = 0;
      do {
        const index = ri(allChords.length - 1);
        chord = allChords[index];
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
```

<!-- END: snippet:RandomChordComposer_regenerateProgression -->

<!-- BEGIN: snippet:RandomChordComposer_x -->

```typescript
x(): any[] {
    this.regenerateProgression();
    return ChordComposer.prototype.x.call(this);
  }
```

<!-- END: snippet:RandomChordComposer_x -->

---

## Usage Example

```typescript
import { ChordComposer, RandomChordComposer } from '../src/composers/ChordComposer';

const iiV = new ChordComposer(['Dm7', 'G7', 'Cmaj7']);
const notes = iiV.x();

const random = new RandomChordComposer();
const randomNotes = random.x();
```

---

## Related Modules

- GenericComposer.ts ([code](../../src/composers/GenericComposer.ts)) ([doc](GenericComposer.md)) - Base class
- MeasureComposer.ts ([code](../../src/composers/MeasureComposer.ts)) ([doc](MeasureComposer.md)) - Timing/voice-leading engine
- ProgressionGenerator.ts ([code](../../src/composers/ProgressionGenerator.ts)) ([doc](ProgressionGenerator.md)) - Generates Roman-numeral progressions

