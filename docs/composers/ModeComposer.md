# ModeComposer.ts - Mode-Based Melodic Composer

> **Source**: `src/composers/ModeComposer.ts`  
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
    this.itemSet(modeName, root);
  }

  itemSet(modeName: string, root: string): void {
    this.root = root;
    this.item = g.t.Mode.get(`${root} ${modeName}`);
    this.notes = this.item.notes || this.item.intervals || [];
    // If item.notes is still empty, fall back to scale
    if (!this.notes || this.notes.length === 0) {
      const scale = g.t.Scale.get(`${root} ${modeName}`);
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
    this.item = g.t.Mode.get(`${root} ${modeName}`);
    this.notes = this.item.notes || this.item.intervals || [];
    // If item.notes is still empty, fall back to scale
    if (!this.notes || this.notes.length === 0) {
      const scale = g.t.Scale.get(`${root} ${modeName}`);
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
    const g = globalThis as any;
    const randomMode = g.allModes[g.ri(g.allModes.length - 1)];
    const randomRoot = g.allNotes[g.ri(g.allNotes.length - 1)];
    this.itemSet(randomMode, randomRoot);
  }

  itemSet(modeName: string, root: string): void {
    const g = globalThis as any;
    this.root = root;
    this.item = g.t.Mode.get(`${root} ${modeName}`);
    this.notes = this.item.notes || this.item.intervals || [];
    // If item.notes is still empty, fall back to scale
    if (!this.notes || this.notes.length === 0) {
      const scale = g.t.Scale.get(`${root} ${modeName}`);
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
    const g = globalThis as any;
    const randomMode = g.allModes[g.ri(g.allModes.length - 1)];
    const randomRoot = g.allNotes[g.ri(g.allNotes.length - 1)];
    this.itemSet(randomMode, randomRoot);
  }
```

<!-- END: snippet:RandomModeComposer_randomizeItem -->

<!-- BEGIN: snippet:RandomModeComposer_itemSet -->

```typescript
itemSet(modeName: string, root: string): void {
    const g = globalThis as any;
    this.root = root;
    this.item = g.t.Mode.get(`${root} ${modeName}`);
    this.notes = this.item.notes || this.item.intervals || [];
    // If item.notes is still empty, fall back to scale
    if (!this.notes || this.notes.length === 0) {
      const scale = g.t.Scale.get(`${root} ${modeName}`);
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

