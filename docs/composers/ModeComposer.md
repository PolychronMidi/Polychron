# ModeComposer.ts - Mode-Based Melodic Composer

> **Status**: Core Composer  
> **Dependencies**: GenericComposer.ts, Tonal Mode/Scale


## Overview

`ModeComposer.ts` generates melodies from Tonal modes with scale fallback. It shares the GenericComposer rhythm/voice-leading engine and includes a random variant for exploring all modes.

**Core Responsibilities:**
- Resolve Tonal mode by name/root; fall back to Tonal scale notes if a mode lacks notes
- Provide deterministic and random variants
- Surface notes to MeasureComposer for register/voice-leading handling

## Architecture Role

- Used by composer defaults when type `mode` is requested
- Complements ScaleComposer with explicit modal semantics (ionian, dorian, etc.)

---

## API

### `class ModeComposer`

Mode-based composer with scale fallback.

<!-- BEGIN: snippet:ModeComposer -->

```typescript
class ModeComposer extends GenericComposer<any> {
  constructor(modeName: string = 'ionian', root: string = 'C') {
    super('mode', root);
    this.mode = modeName; // backward-compatible property expected by tests
    this.itemSet(modeName, root);
  }

  itemSet(modeName: string, root: string): void {
    this.root = root;
    this.mode = modeName;
    this.item = t.Mode.get(`${root} ${modeName}`);
    this.notes = this.item.notes || this.item.intervals || [];
    // If item.notes is still empty, fall back to scale
    if (!this.notes || this.notes.length === 0) {
      const scale = t.Scale.get(`${root} ${modeName}`);
      this.notes = scale.notes || [];
    }
  }
}
```

<!-- END: snippet:ModeComposer -->

#### `itemSet(modeName, root)`

Loads Tonal mode; if empty, falls back to matching scale notes.

<!-- BEGIN: snippet:ModeComposer_itemSet -->

```typescript
itemSet(modeName: string, root: string): void {
    this.root = root;
    this.mode = modeName;
    this.item = t.Mode.get(`${root} ${modeName}`);
    this.notes = this.item.notes || this.item.intervals || [];
    // If item.notes is still empty, fall back to scale
    if (!this.notes || this.notes.length === 0) {
      const scale = t.Scale.get(`${root} ${modeName}`);
      this.notes = scale.notes || [];
    }
  }
```

<!-- END: snippet:ModeComposer_itemSet -->

### `class RandomModeComposer`

Random mode/root selection per instantiation; re-randomizes on `x()`.

<!-- BEGIN: snippet:RandomModeComposer -->

```typescript
class RandomModeComposer extends RandomGenericComposer<any> {
  constructor() {
    super('mode', 'C');
    this.randomizeItem();
  }

  randomizeItem() {
    // Prefer DI/imported arrays, but fall back to legacy globals for tests
    const modes = (Array.isArray(allModes) && allModes.length) ? allModes : (g.allModes || []);
    const notes = (Array.isArray(allNotes) && allNotes.length) ? allNotes : (g.allNotes || []);
    const modeIdx = Math.max(0, ri(modes.length - 1));
    const rootIdx = Math.max(0, ri(notes.length - 1));
    let randomMode = modes[modeIdx] || 'ionian';
    let randomRoot = notes[rootIdx] || 'C';
    // allModes entries may be 'C ionian' strings; handle that format
    if (typeof randomMode === 'string' && randomMode.includes(' ')) {
      const parts = randomMode.split(' ');
      randomRoot = parts[0] || randomRoot;
      randomMode = parts[1] || 'ionian';
    }
    this.itemSet(randomMode, randomRoot);
  }

  itemSet(modeName: string, root: string): void {
    this.root = root;
    this.item = t.Mode.get(`${root} ${modeName}`);
    this.notes = this.item.notes || this.item.intervals || [];
    // If item.notes is still empty, fall back to scale
    if (!this.notes || this.notes.length === 0) {
      const scale = t.Scale.get(`${root} ${modeName}`);
      this.notes = scale.notes || [];
    }
  }
}
```

<!-- END: snippet:RandomModeComposer -->

#### `randomizeItem()` / `itemSet()`

Chooses random mode/root then sets notes with mode-or-scale fallback.

<!-- BEGIN: snippet:RandomModeComposer_randomizeItem -->

```typescript
randomizeItem() {
    // Prefer DI/imported arrays, but fall back to legacy globals for tests
    const modes = (Array.isArray(allModes) && allModes.length) ? allModes : (g.allModes || []);
    const notes = (Array.isArray(allNotes) && allNotes.length) ? allNotes : (g.allNotes || []);
    const modeIdx = Math.max(0, ri(modes.length - 1));
    const rootIdx = Math.max(0, ri(notes.length - 1));
    let randomMode = modes[modeIdx] || 'ionian';
    let randomRoot = notes[rootIdx] || 'C';
    // allModes entries may be 'C ionian' strings; handle that format
    if (typeof randomMode === 'string' && randomMode.includes(' ')) {
      const parts = randomMode.split(' ');
      randomRoot = parts[0] || randomRoot;
      randomMode = parts[1] || 'ionian';
    }
    this.itemSet(randomMode, randomRoot);
  }
```

<!-- END: snippet:RandomModeComposer_randomizeItem -->

<!-- BEGIN: snippet:RandomModeComposer_itemSet -->

```typescript
itemSet(modeName: string, root: string): void {
    this.root = root;
    this.item = t.Mode.get(`${root} ${modeName}`);
    this.notes = this.item.notes || this.item.intervals || [];
    // If item.notes is still empty, fall back to scale
    if (!this.notes || this.notes.length === 0) {
      const scale = t.Scale.get(`${root} ${modeName}`);
      this.notes = scale.notes || [];
    }
  }
```

<!-- END: snippet:RandomModeComposer_itemSet -->

---

## Usage Example

```typescript
import { ModeComposer, RandomModeComposer } from '../src/composers/ModeComposer';

const dorian = new ModeComposer('dorian', 'D');
const notes = dorian.getNotes();

const random = new RandomModeComposer();
const randomNotes = random.x();
```

---

## Related Modules

- GenericComposer.ts ([code](../../src/composers/GenericComposer.ts)) ([doc](GenericComposer.md)) - Base class
- MeasureComposer.ts ([code](../../src/composers/MeasureComposer.ts)) ([doc](MeasureComposer.md)) - Timing/voice-leading engine
- ScaleComposer.ts ([code](../../src/composers/ScaleComposer.ts)) ([doc](ScaleComposer.md)) - Scale-based melodies

