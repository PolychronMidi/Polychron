# PentatonicComposer.ts - Pentatonic Melody Composer

> **Source**: `src/composers/PentatonicComposer.ts`  
> **Status**: Core Composer  
> **Dependencies**: GenericComposer.ts, Tonal Scale

## Overview

`PentatonicComposer.ts` builds melodies from major or minor pentatonic collections, inheriting rhythm/voice-leading from GenericComposer. A random variant swaps root and pentatonic type on each tick.

**Core Responsibilities:**
- Resolve pentatonic scale (major/minor) by root
- Maintain `type` for current pentatonic flavor
- Offer randomization of root/type per call

## Architecture Role

- Included in ComposerRegistry defaults for pentatonic phrasing
- Complements ScaleComposer with five-note textures

---

## API

### `class PentatonicComposer`

Composer for major/minor pentatonic scales.

<!-- BEGIN: snippet:PentatonicComposer -->

```typescript
class PentatonicComposer extends GenericComposer<any> {
  type: string; // 'major' or 'minor'

  constructor(root: string = 'C', scaleType: string = 'major') {
    super('pentatonic', root);
    this.type = scaleType;
    const scaleName = scaleType === 'major' ? 'major pentatonic' : 'minor pentatonic';
    this.itemSet(scaleName, root);
  }

  itemSet(scaleName: string, root: string): void {
    this.root = root;
    this.item = g.t.Scale.get(`${root} ${scaleName}`);
    this.notes = this.item.notes;
  }
}
```

<!-- END: snippet:PentatonicComposer -->

#### `itemSet(scaleName, root)`

Loads pentatonic scale notes by root.

<!-- BEGIN: snippet:PentatonicComposer_itemSet -->

```typescript
itemSet(scaleName: string, root: string): void {
    this.root = root;
    this.item = g.t.Scale.get(`${root} ${scaleName}`);
    this.notes = this.item.notes;
  }
```

<!-- END: snippet:PentatonicComposer_itemSet -->

### `class RandomPentatonicComposer`

Random root/type selection each tick.

<!-- BEGIN: snippet:RandomPentatonicComposer -->

```typescript
class RandomPentatonicComposer extends PentatonicComposer {
  constructor() {
    const randomRoot = g.allNotes[g.ri(g.allNotes.length - 1)];
    const randomType = ['major', 'minor'][g.ri(1)];
    super(randomRoot, randomType);
  }

  noteSet(): void {
    const randomRoot = g.allNotes[g.ri(g.allNotes.length - 1)];
    const randomType = ['major', 'minor'][g.ri(1)];
    this.root = randomRoot;
    this.type = randomType;
    const scaleName = randomType === 'major' ? 'major pentatonic' : 'minor pentatonic';
    this.itemSet(scaleName, randomRoot);
  }

  x(): any[] {
    this.noteSet();
    return super.x();
  }
}
```

<!-- END: snippet:RandomPentatonicComposer -->

#### `noteSet()` / `x()`

Re-randomizes root/type, updates notes, then composes.

<!-- BEGIN: snippet:RandomPentatonicComposer_noteSet -->

```typescript
noteSet(): void {
    const randomRoot = g.allNotes[g.ri(g.allNotes.length - 1)];
    const randomType = ['major', 'minor'][g.ri(1)];
    this.root = randomRoot;
    this.type = randomType;
    const scaleName = randomType === 'major' ? 'major pentatonic' : 'minor pentatonic';
    this.itemSet(scaleName, randomRoot);
  }
```

<!-- END: snippet:RandomPentatonicComposer_noteSet -->

<!-- BEGIN: snippet:RandomPentatonicComposer_x -->

```typescript
x(): any[] {
    this.noteSet();
    return super.x();
  }
```

<!-- END: snippet:RandomPentatonicComposer_x -->

---

## Usage Example

```typescript
import { PentatonicComposer, RandomPentatonicComposer } from '../src/composers/PentatonicComposer';

const majorPent = new PentatonicComposer('G', 'major');
const notes = majorPent.getNotes();

const randomPent = new RandomPentatonicComposer();
const randomNotes = randomPent.x();
```

---

## Related Modules

- GenericComposer.ts ([code](../../src/composers/GenericComposer.ts)) ([doc](GenericComposer.md)) - Base class
- MeasureComposer.ts ([code](../../src/composers/MeasureComposer.ts)) ([doc](MeasureComposer.md)) - Timing/voice-leading engine
- ScaleComposer.ts ([code](../../src/composers/ScaleComposer.ts)) ([doc](ScaleComposer.md)) - Seven-note scales
- ModeComposer.ts ([code](../../src/composers/ModeComposer.ts)) ([doc](ModeComposer.md)) - Modal scales

