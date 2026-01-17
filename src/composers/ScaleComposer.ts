// @ts-check
// ScaleComposer - Composes notes from specific scales
// Now using GenericComposer<Scale> base class to reduce duplication

import GenericComposer, { RandomGenericComposer } from './GenericComposer.js';

/**
 * Composes notes from a specific scale.
 * @extends GenericComposer<Scale>
 */
class ScaleComposer extends GenericComposer {
  constructor(scaleName: string, root: string) {
    super('scale', root);
    this.itemSet(scaleName, root);
  }

  itemSet(scaleName: string, root: string): void {
    this.root = root;
    this.item = (globalThis as any).t.Scale.get(`${root} ${scaleName}`);
    this.notes = this.item.notes;
  }
}

/**
 * Random scale selection from all available scales.
 * @extends GenericComposer<Scale>
 */
class RandomScaleComposer extends RandomGenericComposer {
  constructor() {
    super('scale', 'C');
    this.randomizeItem();
  }

  randomizeItem() {
    const randomScale = (globalThis as any).allScales[(globalThis as any).ri((globalThis as any).allScales.length - 1)];
    const randomRoot = (globalThis as any).allNotes[(globalThis as any).ri((globalThis as any).allNotes.length - 1)];
    this.itemSet(randomScale, randomRoot);
  }

  itemSet(scaleName: string, root: string): void {
    this.root = root;
    this.item = (globalThis as any).t.Scale.get(`${root} ${scaleName}`);
    this.notes = this.item.notes;
  }
}


export default ScaleComposer;
export { ScaleComposer, RandomScaleComposer };
