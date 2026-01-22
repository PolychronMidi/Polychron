// @ts-check
// ModeComposer - Composes notes from specific modes
// Using GenericComposer<Mode> base class to reduce duplication

import GenericComposer, { RandomGenericComposer } from './GenericComposer.js';
import * as t from 'tonal';
import { allModes, allNotes } from '../venue.js';
import { ri } from '../utils.js';

/**
 * Composes notes from a specific mode.
 * @extends GenericComposer<Mode>
 */
class ModeComposer extends GenericComposer<any> {
  mode: string;
  constructor(modeName: string = 'ionian', root: string = 'C') {
    super('mode', root);
    this.mode = modeName; // backward-compatible property expected by tests
    this.itemSet(modeName, root);
  }

  itemSet(modeName: string, root: string): void {
    this.root = root;
    this.mode = modeName;
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
    // DI-only: require upstream to provide `allModes` and `allNotes` arrays via module imports or DI.
    if (!Array.isArray(allModes) || allModes.length === 0) throw new Error('ModeComposer requires DI-provided `allModes` array');
    if (!Array.isArray(allNotes) || allNotes.length === 0) throw new Error('ModeComposer requires DI-provided `allNotes` array');
    const modes = allModes;
    const notes = allNotes;
    const modeIdx = Math.max(0, ri(modes.length - 1));
    const rootIdx = Math.max(0, ri(notes.length - 1));
    let randomMode = modes[modeIdx] || 'ionian';
    let randomRoot = notes[rootIdx] || 'C';
    // allModes entries may be 'C ionian' strings; handle that format
    if (typeof randomMode === 'string' && randomMode.includes(' ')) {
      const parts = randomMode.split(' ');
      randomRoot = parts[0] || randomRoot;
      randomMode = parts[1] || 'ionian';
    }
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
