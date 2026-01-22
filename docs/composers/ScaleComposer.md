# ScaleComposer.ts - Scale-Based Melodic Composer

> **Status**: Core Composer  
> **Dependencies**: GenericComposer.ts, Tonal Scale


## Overview

`ScaleComposer.ts` builds melodic material from a chosen scale and root, leveraging GenericComposer for rhythm/voice leading. A random variant picks both scale and root from global pools.

**Core Responsibilities:**
- Fetch Tonal scale by name/root and expose `notes`
- Provide deterministic and random variants for scale selection
- Defer note shaping to MeasureComposer via GenericComposer

## Architecture Role

- Used by play.ts and ComposerRegistry defaults for scale-driven passages
- Serves as the fallback when unknown composer types are requested

---

## API

### `class ScaleComposer`

Deterministic scale composer for a given scale name and root.

<!-- BEGIN: snippet:ScaleComposer -->

```typescript
class ScaleComposer extends GenericComposer<any> {
  constructor(scaleName: string, root: string) {
    super('scale', root);
    this.scale = scaleName; // backward-compatible property expected by tests
    this.itemSet(scaleName, root);
  }

  itemSet(scaleName: string, root: string): void {
    this.root = root;
    this.scale = scaleName;
    this.item = t.Scale.get(`${root} ${scaleName}`);
    this.notes = this.item.notes;
  }
}
```

<!-- END: snippet:ScaleComposer -->

#### `itemSet(scaleName, root)`

Loads Tonal scale and stores note list.

<!-- BEGIN: snippet:ScaleComposer_itemSet -->

```typescript
itemSet(scaleName: string, root: string): void {
    this.root = root;
    this.scale = scaleName;
    this.item = t.Scale.get(`${root} ${scaleName}`);
    this.notes = this.item.notes;
  }
```

<!-- END: snippet:ScaleComposer_itemSet -->

### `class RandomScaleComposer`

Random scale/root selection each instantiation; re-randomizes on `x()`.

<!-- BEGIN: snippet:RandomScaleComposer -->

```typescript
class RandomScaleComposer extends RandomGenericComposer<any> {
  constructor() {
    super('scale', 'C');
    this.randomizeItem();
  }

  randomizeItem() {
    const randomScale = allScales[ri(allScales.length - 1)];
    const randomRoot = allNotes[ri(allNotes.length - 1)];
    this.itemSet(randomScale, randomRoot);
  }

  itemSet(scaleName: string, root: string): void {
    this.root = root;
    this.item = t.Scale.get(`${root} ${scaleName}`);
    this.notes = this.item.notes;
  }
}
```

<!-- END: snippet:RandomScaleComposer -->

#### `randomizeItem()` / `itemSet()`

Chooses random scale/root from globals, then sets notes.

<!-- BEGIN: snippet:RandomScaleComposer_randomizeItem -->

```typescript
randomizeItem() {
    const randomScale = allScales[ri(allScales.length - 1)];
    const randomRoot = allNotes[ri(allNotes.length - 1)];
    this.itemSet(randomScale, randomRoot);
  }
```

<!-- END: snippet:RandomScaleComposer_randomizeItem -->

<!-- BEGIN: snippet:RandomScaleComposer_itemSet -->

```typescript
itemSet(scaleName: string, root: string): void {
    this.root = root;
    this.item = t.Scale.get(`${root} ${scaleName}`);
    this.notes = this.item.notes;
  }
```

<!-- END: snippet:RandomScaleComposer_itemSet -->

---

## Usage Example

```typescript
import { ScaleComposer, RandomScaleComposer } from '../src/composers/ScaleComposer';

const majorC = new ScaleComposer('major', 'C');
const notes = majorC.getNotes();

const random = new RandomScaleComposer();
const randomNotes = random.x();
```

---

## Related Modules

- GenericComposer.ts ([code](../../src/composers/GenericComposer.ts)) ([doc](GenericComposer.md)) - Base class
- MeasureComposer.ts ([code](../../src/composers/MeasureComposer.ts)) ([doc](MeasureComposer.md)) - Timing/voice-leading engine
- ModeComposer.ts ([code](../../src/composers/ModeComposer.ts)) ([doc](ModeComposer.md)) - Mode-focused melodies
- ChordComposer.ts ([code](../../src/composers/ChordComposer.ts)) ([doc](ChordComposer.md)) - Progression-based harmony

