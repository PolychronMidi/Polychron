# motifs.ts - Melodic Motif Utilities

> **Status**: Core Melody Utility  
> **Dependencies**: `NoteEvent`, pitch scaling helpers, random


## Overview

`motifs.ts` defines the `Motif` class and helpers to create, transform, and apply melodic motifs to note streams. It offers inversion, transposition, augmentation/diminution, reversal, probabilistic development, and safe note clamping to keep pitches in range.

**Core Responsibilities:**
- Represent a motif as a list of motif notes with durations and optional rest flags
- Provide transformations (transpose, invert, augment/diminish, reverse)
- Probabilistically develop motifs (mutations and repeats)
- Apply motifs onto note arrays respecting key, pitch bounds, and swing

---

## API

### `class Motif`

Motif container with transformation helpers.

<!-- BEGIN: snippet:Motif -->

```typescript
class Motif {
  sequence: NoteEvent[];
  defaultDuration: number;

  /**
   * Create a new Motif
   * @param sequence - Array of notes or note events
   * @param options - Configuration options
   */
  constructor(sequence: Array<number | { note?: number; duration?: number }> = [], options: { defaultDuration?: number } = {}) {
    const { defaultDuration = 1 } = options;
    this.sequence = Array.isArray(sequence)
      ? sequence.map((evt) => normalizeEvent(evt, defaultDuration))
      : [];
    this.defaultDuration = defaultDuration;
  }

  /**
   * Returns a deep-copied sequence.
   * @returns Array of note events
   */
  get events(): NoteEvent[] {
    return this.sequence.map(({ note, duration }) => ({ note, duration }));
  }

  /**
   * Transpose motif by semitones.
   * @param semitones - Number of semitones to transpose
   * @returns New transposed Motif
   */
  transpose(semitones: number = 0): Motif {
    return new Motif(this.sequence.map(({ note, duration }) => ({
      note: clampNote(note + semitones),
      duration
    })), { defaultDuration: this.defaultDuration });
  }

  /**
   * Invert motif around a pivot (default: first note).
   * @param pivot - Pivot note for inversion (null = use first note)
   * @returns New inverted Motif
   */
  invert(pivot: number | null = null): Motif {
    const pivotNote = pivot === null
      ? (this.sequence[0]?.note ?? 0)
      : pivot;
    return new Motif(this.sequence.map(({ note, duration }) => ({
      note: clampNote(pivotNote - (note - pivotNote)),
      duration
    })), { defaultDuration: this.defaultDuration });
  }

  /**
   * Augment durations by factor.
   * @param factor - Multiplication factor
   * @returns New augmented Motif
   */
  augment(factor: number = 2): Motif {
    const safeFactor = factor <= 0 ? 1 : factor;
    return new Motif(this.sequence.map(({ note, duration }) => ({
      note,
      duration: duration * safeFactor
    })), { defaultDuration: this.defaultDuration * safeFactor });
  }

  /**
   * Diminish durations by factor.
   * @param factor - Division factor
   * @returns New diminished Motif
   */
  diminish(factor: number = 2): Motif {
    const safeFactor = factor <= 0 ? 1 : factor;
    return new Motif(this.sequence.map(({ note, duration }) => ({
      note,
      duration: duration / safeFactor
    })), { defaultDuration: this.defaultDuration / safeFactor });
  }

  /**
   * Reverse motif order.
   * @returns New reversed Motif
   */
  reverse(): Motif {
    return new Motif([...this.sequence].reverse(), { defaultDuration: this.defaultDuration });
  }

  /**
   * Apply a small development chain: transpose, optional inversion, optional reverse, optional scaling.
   * @param options - Development options
   * @returns New developed Motif
   */
  develop(options: {
    transposeBy?: number;
    invertPivot?: number | false;
    reverse?: boolean;
    scale?: number;
  } = {}): Motif {
    const {
      transposeBy = 12,
      invertPivot = null,
      reverse = false,
      scale = 1
    } = options;
    let next: Motif = this;
    if (transposeBy !== 0) {
      next = next.transpose(transposeBy) as Motif;
    }
    if (invertPivot !== false) {
      const pivot = invertPivot as number | null;
      next = next.invert(pivot) as Motif;
    }
    if (reverse) {
      next = next.reverse() as Motif;
    }
    if (scale !== 1) {
      next = scale > 1 ? next.augment(scale) as Motif : next.diminish(1 / scale) as Motif;
    }
    return next;
  }

  /**
   * Apply motif offsets to an array of note objects (non-mutating).
   * Calculates interval offset from motif's first note and applies to each input note.
   * @param notes - Array of note objects
   * @param options - Clamping options
   * @returns New array of adjusted notes
   */
  applyToNotes(notes: Array<{ note?: number; [key: string]: any }> = [], options: { clampMin?: number; clampMax?: number } = {}): Array<{ note: number; [key: string]: any }> {
    if (!Array.isArray(notes) || notes.length === 0 || this.sequence.length === 0) {
      return Array.isArray(notes) ? (notes as any[]) : [];
    }
    const { clampMin = 0, clampMax = 127 } = options;
    const baseNote = this.sequence[0].note;
    return notes.map((noteObj, idx) => {
      const motifEvent = this.sequence[idx % this.sequence.length];
      const offset = motifEvent.note - baseNote;
      const newNote = clampNote((noteObj?.note ?? 0) + offset, clampMin, clampMax);
      return { ...noteObj, note: newNote };
    });
  }
}
```

<!-- END: snippet:Motif -->

#### `transpose(semitones)`
Shift all motif notes by semitones.

<!-- BEGIN: snippet:Motif_transpose -->

```typescript
transpose(semitones: number = 0): Motif {
    return new Motif(this.sequence.map(({ note, duration }) => ({
      note: clampNote(note + semitones),
      duration
    })), { defaultDuration: this.defaultDuration });
  }
```

<!-- END: snippet:Motif_transpose -->

#### `invert()`
Mirror around the first note.

<!-- BEGIN: snippet:Motif_invert -->

```typescript
invert(pivot: number | null = null): Motif {
    const pivotNote = pivot === null
      ? (this.sequence[0]?.note ?? 0)
      : pivot;
    return new Motif(this.sequence.map(({ note, duration }) => ({
      note: clampNote(pivotNote - (note - pivotNote)),
      duration
    })), { defaultDuration: this.defaultDuration });
  }
```

<!-- END: snippet:Motif_invert -->

#### `augment(factor)` / `diminish(factor)`
Scale durations by factor (e.g., 2 for augmentation, 0.5 for diminution).

<!-- BEGIN: snippet:Motif_augment -->

```typescript
augment(factor: number = 2): Motif {
    const safeFactor = factor <= 0 ? 1 : factor;
    return new Motif(this.sequence.map(({ note, duration }) => ({
      note,
      duration: duration * safeFactor
    })), { defaultDuration: this.defaultDuration * safeFactor });
  }
```

<!-- END: snippet:Motif_augment -->

<!-- BEGIN: snippet:Motif_diminish -->

```typescript
diminish(factor: number = 2): Motif {
    const safeFactor = factor <= 0 ? 1 : factor;
    return new Motif(this.sequence.map(({ note, duration }) => ({
      note,
      duration: duration / safeFactor
    })), { defaultDuration: this.defaultDuration / safeFactor });
  }
```

<!-- END: snippet:Motif_diminish -->

#### `reverse()`
Reverse note order while keeping durations aligned.

<!-- BEGIN: snippet:Motif_reverse -->

```typescript
reverse(): Motif {
    return new Motif([...this.sequence].reverse(), { defaultDuration: this.defaultDuration });
  }
```

<!-- END: snippet:Motif_reverse -->

#### `develop(options)`
Randomly mutate, repeat, and rest notes based on probabilities.

<!-- BEGIN: snippet:Motif_develop -->

```typescript
develop(options: {
    transposeBy?: number;
    invertPivot?: number | false;
    reverse?: boolean;
    scale?: number;
  } = {}): Motif {
    const {
      transposeBy = 12,
      invertPivot = null,
      reverse = false,
      scale = 1
    } = options;
    let next: Motif = this;
    if (transposeBy !== 0) {
      next = next.transpose(transposeBy) as Motif;
    }
    if (invertPivot !== false) {
      const pivot = invertPivot as number | null;
      next = next.invert(pivot) as Motif;
    }
    if (reverse) {
      next = next.reverse() as Motif;
    }
    if (scale !== 1) {
      next = scale > 1 ? next.augment(scale) as Motif : next.diminish(1 / scale) as Motif;
    }
    return next;
  }
```

<!-- END: snippet:Motif_develop -->

#### `applyToNotes(notes, options)`
Overlay motif onto note list with clamping and swing.

<!-- BEGIN: snippet:Motif_applyToNotes -->

```typescript
applyToNotes(notes: Array<{ note?: number; [key: string]: any }> = [], options: { clampMin?: number; clampMax?: number } = {}): Array<{ note: number; [key: string]: any }> {
    if (!Array.isArray(notes) || notes.length === 0 || this.sequence.length === 0) {
      return Array.isArray(notes) ? (notes as any[]) : [];
    }
    const { clampMin = 0, clampMax = 127 } = options;
    const baseNote = this.sequence[0].note;
    return notes.map((noteObj, idx) => {
      const motifEvent = this.sequence[idx % this.sequence.length];
      const offset = motifEvent.note - baseNote;
      const newNote = clampNote((noteObj?.note ?? 0) + offset, clampMin, clampMax);
      return { ...noteObj, note: newNote };
    });
  }
```

<!-- END: snippet:Motif_applyToNotes -->

### Helpers

- `clampMotifNote(note, options)` - keep pitches within bounds
- `clampNote(note, options)` - ensure final note respects scale/pitch limits

---

## Usage Example

```typescript
import { Motif } from '../src/motifs';

const motif = new Motif([{ note: 60, duration: 1 }, { note: 62, duration: 1 }]);
motif.transpose(5).invert();
const developed = motif.develop({ repeatChance: 0.2, mutateChance: 0.3 });
const notes = motif.applyToNotes([], { pitchRange: [48, 72] });
```

---

## Related Modules

- composers/ModeComposer ([code](../src/composers/ModeComposer.ts)) ([doc](modeComposer.md)) - Builds modal motifs
- playNotes.ts ([code](../src/playNotes.ts)) ([doc](playNotes.md)) - Renders motif-applied notes
- rhythm.ts ([code](../src/rhythm.ts)) ([doc](rhythm.md)) - Rhythmic patterns to pair with motifs

