// @ts-check
// PentatonicComposer - Composes notes from pentatonic scales
// Using GenericComposer<Pentatonic> base class to reduce duplication

import './GenericComposer.js';

/**
 * Composes notes from pentatonic scales.
 * @extends GenericComposer<Pentatonic>
 */
class PentatonicComposer extends (globalThis as any).GenericComposer {
  type: string; // 'major' or 'minor'

  constructor(root: string = 'C', scaleType: string = 'major') {
    super('pentatonic', root);
    this.type = scaleType;
    const scaleName = scaleType === 'major' ? 'major pentatonic' : 'minor pentatonic';
    this.itemSet(scaleName, root);
  }

  itemSet(scaleName: string, root: string): void {
    this.root = root;
    this.item = (globalThis as any).t.Scale.get(`${root} ${scaleName}`);
    this.scale = this.item; // Backward compatibility
    this.notes = this.item.notes;
  }

  // Backward compatibility alias for RandomPentatonicComposer
  noteSet(scaleName: string, root: string): void {
    this.itemSet(scaleName, root);
  }
}

/**
 * Random pentatonic scale selection.
 * @extends GenericComposer<Pentatonic>
 */
class RandomPentatonicComposer extends PentatonicComposer {
  constructor() {
    const randomRoot = (globalThis as any).allNotes[(globalThis as any).ri((globalThis as any).allNotes.length - 1)];
    const randomType = ['major', 'minor'][(globalThis as any).ri(1)];
    super(randomRoot, randomType);
  }

  noteSet(): void {
    const randomRoot = (globalThis as any).allNotes[(globalThis as any).ri((globalThis as any).allNotes.length - 1)];
    const randomType = ['major', 'minor'][(globalThis as any).ri(1)];
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

// Export to global scope
(globalThis as any).PentatonicComposer = PentatonicComposer;
(globalThis as any).RandomPentatonicComposer = RandomPentatonicComposer;
export { PentatonicComposer, RandomPentatonicComposer };
