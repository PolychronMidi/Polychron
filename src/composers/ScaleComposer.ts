// @ts-check
// ScaleComposer - Composes notes from specific scales

import './MeasureComposer.js';

/**
 * Composes notes from a specific scale.
 * @extends MeasureComposer
 */
class ScaleComposer extends (globalThis as any).MeasureComposer {
  root: string;
  scale: any;
  notes: any[];

  constructor(scaleName: string, root: string) {
    super();
    this.root = root;
    this.notes = [];
    this.noteSet(scaleName, root);
  }

  noteSet(scaleName: string, root: string): void {
    this.scale = (globalThis as any).t.Scale.get(`${root} ${scaleName}`);
    this.notes = this.scale.notes;
  }

  getNotes(): any[] {
    return (globalThis as any).MeasureComposer.prototype.getNotes.call(this);
  }

  x(): any[] {
    return this.getNotes();
  }
}

/**
 * Random scale selection from all available scales.
 * @extends ScaleComposer
 */
class RandomScaleComposer extends ScaleComposer {
  constructor() {
    super('','');
    this.noteSet();
  }
  /** Randomly selects scale and root from venue.js data */
  noteSet() {
    const randomScale=allScales[ri(allScales.length - 1)];
    const randomRoot=allNotes[ri(allNotes.length - 1)];
    super.noteSet(randomScale,randomRoot);
  }
  /** @returns {{note: number}[]} Random scale notes */
  x() { this.noteSet(); return super.x(); }
}


// Export to global scope
globalThis.ScaleComposer = ScaleComposer;
globalThis.RandomScaleComposer = RandomScaleComposer;
export { ScaleComposer, RandomScaleComposer };
