// @ts-check
// ModeComposer - Composes notes from specific modes
// Using GenericComposer<Mode> base class to reduce duplication

import GenericComposer, { RandomGenericComposer } from './GenericComposer.js';

/**
 * Composes notes from a specific mode.
 * @extends GenericComposer<Mode>
 */
class ModeComposer extends GenericComposer {
  constructor(modeName: string = 'ionian', root: string = 'C') {
    super('mode', root);
    this.itemSet(modeName, root);
  }

  itemSet(modeName: string, root: string): void {
    this.root = root;
    this.item = (globalThis as any).t.Mode.get(`${root} ${modeName}`);
    this.notes = this.item.notes || this.item.intervals || [];
    // If item.notes is still empty, fall back to scale
    if (!this.notes || this.notes.length === 0) {
      const scale = (globalThis as any).t.Scale.get(`${root} ${modeName}`);
      this.notes = scale.notes || [];
    }
  }
}

/**
 * Random mode selection from all available modes.
 * @extends GenericComposer<Mode>
 */
class RandomModeComposer extends RandomGenericComposer {
  constructor() {
    super('mode', 'C');
    this.randomizeItem();
  }

  randomizeItem() {
    const randomMode = (globalThis as any).allModes[(globalThis as any).ri((globalThis as any).allModes.length - 1)];
    const randomRoot = (globalThis as any).allNotes[(globalThis as any).ri((globalThis as any).allNotes.length - 1)];
    this.itemSet(randomMode, randomRoot);
  }

  itemSet(modeName: string, root: string): void {
    this.root = root;
    this.item = (globalThis as any).t.Mode.get(`${root} ${modeName}`);
    this.notes = this.item.notes || this.item.intervals || [];
    // If item.notes is still empty, fall back to scale
    if (!this.notes || this.notes.length === 0) {
      const scale = (globalThis as any).t.Scale.get(`${root} ${modeName}`);
      this.notes = scale.notes || [];
    }
  }
}


export default ModeComposer;
export { ModeComposer, RandomModeComposer };
