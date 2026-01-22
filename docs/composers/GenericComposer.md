# GenericComposer.ts - Base for Scale/Mode/Chord/Pentatonic

> **Status**: Core Composer Base  
> **Dependencies**: MeasureComposer.ts


## Overview

`GenericComposer.ts` provides the shared machinery for scale-like composers (scale, mode, chord, pentatonic). It handles item bookkeeping, delegates note generation to the MeasureComposer engine, and offers a randomized variant base. Subclasses only implement `itemSet()` to fetch a Tonal entity and populate `notes`.

**Core Responsibilities:**
- Maintain `itemType`, `root`, current `item`, and `notes`
- Standardize `getNotes()` and `x()` behavior using MeasureComposer
- Provide `RandomGenericComposer` to re-randomize items per call

## Architecture Role

- Used by ScaleComposer.ts, ModeComposer.ts, ChordComposer.ts, and PentatonicComposer.ts for common note-generation flow
- Bridges MeasureComposer rhythmic/voice-leading logic with Tonal lookups supplied by subclasses
- Simplifies creation of randomized composers through `RandomGenericComposer`

---

## API

### `abstract class GenericComposer<T>`

Base class for scale-like composers. Subclasses implement `itemSet(name, root)`.

<!-- BEGIN: snippet:GenericComposer -->

```typescript
abstract class GenericComposer<T> extends MeasureComposer {
  root: string;
  itemType: string; // "scale", "mode", "chord", "pentatonic"
  item: T | null;
  notes: any[];

  constructor(itemType: string, root: string = 'C') {
    super();
    this.itemType = itemType;
    // Backward-compatible 'type' property expected by tests and legacy code
    (this as any).type = itemType;
    this.root = root;
    this.item = null;
    this.notes = [];
  }

  /**
   * Override in subclass to fetch and set notes from Tonal library.
   * Expected signature: itemSet(name: string, root: string): void
   * Should set this.item and this.notes
   */
  abstract itemSet(name: string, root: string): void;

  /**
   * Standard getNotes implementation - calls parent MeasureComposer.getNotes()
   * Subclasses inherit this unless they need special logic
   */
  getNotes(octaveRange?: number[] | null): any[] {
    return MeasureComposer.prototype.getNotes.call(this, octaveRange);
  }

  /**
   * Standard x() implementation - calls getNotes()
   * Subclasses can override to regenerate items on each call (Random variants)
   */
  x(): any[] {
    return this.getNotes();
  }
}
```

<!-- END: snippet:GenericComposer -->

#### `itemSet(name, root)`

Subclass hook to set `item` and `notes` from Tonal.

<!-- BEGIN: snippet:GenericComposer_itemSet -->

```typescript
abstract itemSet(name: string, root: string): void;
```

<!-- END: snippet:GenericComposer_itemSet -->

#### `getNotes(octaveRange?)`

Returns notes via MeasureComposer logic (voice leading, meter-aware spreads).

<!-- BEGIN: snippet:GenericComposer_getNotes -->

```typescript
getNotes(octaveRange?: number[] | null): any[] {
    return MeasureComposer.prototype.getNotes.call(this, octaveRange);
  }
```

<!-- END: snippet:GenericComposer_getNotes -->

#### `x()`

Default tick: delegates to `getNotes()`.

<!-- BEGIN: snippet:GenericComposer_x -->

```typescript
x(): any[] {
    return this.getNotes();
  }
```

<!-- END: snippet:GenericComposer_x -->

### `abstract class RandomGenericComposer<T>`

Base for randomized variants; subclasses implement `randomizeItem()`.

<!-- BEGIN: snippet:RandomGenericComposer -->

```typescript
abstract class RandomGenericComposer<T> extends GenericComposer<T> {
  /**
   * Override in subclass to randomize parameters.
   * Expected: set random root/name, call itemSet, update this.item and this.notes
   */
  abstract randomizeItem(): void;

  /**
   * Random variants regenerate on each call
   */
  x(): any[] {
    this.randomizeItem();
    return this.getNotes();
  }
}
```

<!-- END: snippet:RandomGenericComposer -->

#### `randomizeItem()`

Subclass hook to reseed item/root before each tick.

<!-- BEGIN: snippet:RandomGenericComposer_randomizeItem -->

```typescript
abstract randomizeItem(): void;
```

<!-- END: snippet:RandomGenericComposer_randomizeItem -->

#### `x()`

Calls `randomizeItem()` then returns `getNotes()`.

<!-- BEGIN: snippet:RandomGenericComposer_x -->

```typescript
x(): any[] {
    this.randomizeItem();
    return this.getNotes();
  }
```

<!-- END: snippet:RandomGenericComposer_x -->

---

## Usage Example

```typescript
// Create a custom composer using the generic base
class TriadComposer extends GenericComposer<any> {
	constructor(root = 'C') {
		super('triad', root);
		this.itemSet('major', root);
	}

	itemSet(kind: string, root: string) {
		const chord = g.t.Chord.get(`${root}${kind === 'major' ? 'maj' : 'm'}`);
		this.root = root;
		this.item = chord;
		this.notes = chord.notes;
	}
}

const triads = new TriadComposer('D');
const notes = triads.getNotes();
```

---

## Related Modules

- MeasureComposer.ts ([code](../../src/composers/MeasureComposer.ts)) ([doc](MeasureComposer.md)) - Rhythmic and voice-leading engine
- ScaleComposer.ts ([code](../../src/composers/ScaleComposer.ts)) ([doc](ScaleComposer.md)) - Scale-based melodies
- ModeComposer.ts ([code](../../src/composers/ModeComposer.ts)) ([doc](ModeComposer.md)) - Mode-based melodies
- ChordComposer.ts ([code](../../src/composers/ChordComposer.ts)) ([doc](ChordComposer.md)) - Progression-aware chords
- PentatonicComposer.ts ([code](../../src/composers/PentatonicComposer.ts)) ([doc](PentatonicComposer.md)) - Pentatonic phrasing

