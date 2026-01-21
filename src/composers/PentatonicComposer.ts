// @ts-check
// PentatonicComposer - Composes notes from pentatonic scales
// Using GenericComposer<Pentatonic> base class to reduce duplication

import GenericComposer from './GenericComposer.js';
import * as t from 'tonal';
import { allNotes } from '../venue.js';

const g = globalThis as any;

/**
 * Composes notes from pentatonic scales.
 * @extends GenericComposer<Pentatonic>
 */
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
    this.item = t.Scale.get(`${root} ${scaleName}`);
    this.notes = this.item.notes;
  }
}

/**
 * Random pentatonic scale selection.
 * @extends GenericComposer<Pentatonic>
 */
class RandomPentatonicComposer extends PentatonicComposer {
  constructor() {
    const randomRoot = allNotes[g.ri(allNotes.length - 1)];
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


export default PentatonicComposer;
export { PentatonicComposer, RandomPentatonicComposer };
