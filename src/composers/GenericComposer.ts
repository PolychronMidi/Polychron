// @ts-check
// GenericComposer.ts - Generic base class for scale-like composers (Scale, Mode, Chord, Pentatonic)
// Reduces code duplication across composers by ~200-300 lines

import './MeasureComposer.js';

/**
 * Generic composer base class parameterized by item type T.
 * Common pattern: itemSet(name, root) -> items array -> getNotes() calls parent
 *
 * Type Parameter T represents the musical entity being composed:
 * - Scale: Scale notation (e.g., "C major")
 * - Mode: Mode notation (e.g., "C ionian")
 * - Chord: Chord notation (e.g., "Cmaj7")
 * - Pentatonic: Pentatonic scale notation (e.g., "C major pentatonic")
 */
abstract class GenericComposer<T> extends (globalThis as any).MeasureComposer {
  root: string;
  itemType: string; // "scale", "mode", "chord", "pentatonic"
  item: T | null;
  notes: any[];
  scale: T | null; // Backward compatibility alias for item (scale/mode/chord/pentatonic)

  constructor(itemType: string, root: string = 'C') {
    super();
    this.itemType = itemType;
    this.root = root;
    this.item = null;
    this.scale = null; // Backward compatibility
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
    return (globalThis as any).MeasureComposer.prototype.getNotes.call(this, octaveRange);
  }

  /**
   * Standard x() implementation - calls getNotes()
   * Subclasses can override to regenerate items on each call (Random variants)
   */
  x(): any[] {
    return this.getNotes();
  }
}

/**
 * Generic random composer base class for randomized variants.
 * Regenerates item (scale/mode/chord) on each x() call.
 */
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

// Export to global scope for use in index.ts
(globalThis as any).GenericComposer = GenericComposer;
(globalThis as any).RandomGenericComposer = RandomGenericComposer;

export { GenericComposer, RandomGenericComposer };
