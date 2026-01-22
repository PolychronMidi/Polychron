// @ts-check
// ScaleComposer - Composes notes from specific scales
// Now using GenericComposer<Scale> base class to reduce duplication

import GenericComposer, { RandomGenericComposer } from './GenericComposer.js';
import * as t from 'tonal';
import { allScales, allNotes } from '../venue.js';
import { ri } from '../utils.js';

/**
 * Composes notes from a specific scale.
 * @extends GenericComposer<Scale>
 */
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


export default ScaleComposer;
export { ScaleComposer, RandomScaleComposer };
