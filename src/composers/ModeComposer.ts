// @ts-check
// ModeComposer - Composes notes from specific modes
// Using GenericComposer<Mode> base class to reduce duplication

import GenericComposer, { RandomGenericComposer } from './GenericComposer.js';

const g = globalThis as any;

/**
 * Composes notes from a specific mode.
 * @extends GenericComposer<Mode>
 */
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

/**
 * Random mode selection from all available modes.
 * @extends GenericComposer<Mode>
 */
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


export default ModeComposer;
export { ModeComposer, RandomModeComposer };
