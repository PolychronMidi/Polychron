// @ts-check
// ScaleComposer - Composes notes from specific scales
// Now using GenericComposer<Scale> base class to reduce duplication

import GenericComposer, { RandomGenericComposer } from './GenericComposer.js';
import * as t from 'tonal';
import { allScales, allNotes } from '../venue.js';

const g = globalThis as any;

/**
 * Composes notes from a specific scale.
 * @extends GenericComposer<Scale>
 */
class ScaleComposer extends GenericComposer<any> {
  constructor(scaleName: string, root: string) {
    super('scale', root);
    this.itemSet(scaleName, root);
  }

  itemSet(scaleName: string, root: string): void {
    this.root = root;
    this.item = t.Scale.get(`${root} ${scaleName}`);
    this.notes = this.item.notes;
  }
}

/**
 * Random scale selection from all available scales.
 * @extends GenericComposer<Scale>
 */
class RandomScaleComposer extends RandomGenericComposer<any> {
  constructor() {
    super('scale', 'C');
    this.randomizeItem();
  }

  randomizeItem() {
    const randomScale = allScales[g.ri(allScales.length - 1)];
    const randomRoot = allNotes[g.ri(allNotes.length - 1)];
    this.itemSet(randomScale, randomRoot);
  }

  itemSet(scaleName: string, root: string): void {
    this.root = root;
    this.item = t.Scale.get(`${root} ${scaleName}`);
    this.notes = this.item.notes;
  }
}


export default ScaleComposer;
export { ScaleComposer, RandomScaleComposer };
