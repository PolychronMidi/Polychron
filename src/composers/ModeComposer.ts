// @ts-check
// ModeComposer - Composes notes from specific modes
// Using GenericComposer<Mode> base class to reduce duplication

import GenericComposer, { RandomGenericComposer } from './GenericComposer.js';
import * as t from 'tonal';
import { allModes, allNotes } from '../venue.js';

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
    this.item = t.Mode.get(`${root} ${modeName}`);
    this.notes = this.item.notes || this.item.intervals || [];
    // If item.notes is still empty, fall back to scale
    if (!this.notes || this.notes.length === 0) {
      const scale = t.Scale.get(`${root} ${modeName}`);
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
    // Prefer DI/imported arrays, but fall back to legacy globals for tests
    const modes = (Array.isArray(allModes) && allModes.length) ? allModes : (g.allModes || []);
    const notes = (Array.isArray(allNotes) && allNotes.length) ? allNotes : (g.allNotes || []);
    const modeIdx = Math.max(0, (g.ri && typeof g.ri === 'function') ? g.ri(modes.length - 1) : 0);
    const rootIdx = Math.max(0, (g.ri && typeof g.ri === 'function') ? g.ri(notes.length - 1) : 0);
    const randomMode = modes[modeIdx] || 'ionian';
    const randomRoot = notes[rootIdx] || 'C';
    this.itemSet(randomMode, randomRoot);
  }

  itemSet(modeName: string, root: string): void {
    this.root = root;
    this.item = t.Mode.get(`${root} ${modeName}`);
    this.notes = this.item.notes || this.item.intervals || [];
    // If item.notes is still empty, fall back to scale
    if (!this.notes || this.notes.length === 0) {
      const scale = t.Scale.get(`${root} ${modeName}`);
      this.notes = scale.notes || [];
    }
  }
}


export default ModeComposer;
export { ModeComposer, RandomModeComposer };
