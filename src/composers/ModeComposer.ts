// @ts-check
// ModeComposer - Composes notes from specific modes
// Using GenericComposer<Mode> base class to reduce duplication

import './GenericComposer.js';

/**
 * Composes notes from a specific mode.
 * @extends GenericComposer<Mode>
 */
class ModeComposer extends (globalThis as any).GenericComposer {
  mode: any; // Backward compatibility alias

  constructor(modeName: string = 'ionian', root: string = 'C') {
    super('mode', root);
    this.itemSet(modeName, root);
  }

  itemSet(modeName: string, root: string): void {
    this.root = root;
    this.mode = (globalThis as any).t.Mode.get(`${root} ${modeName}`);
    this.item = this.mode; // Backward compatibility
    this.scale = this.mode; // Backward compatibility
    this.notes = this.mode.notes || this.mode.intervals || [];
    // If mode.notes is still empty, fall back to scale
    if (!this.notes || this.notes.length === 0) {
      const scale = (globalThis as any).t.Scale.get(`${root} ${modeName}`);
      this.notes = scale.notes || [];
    }
  }

  // Backward compatibility alias for index.ts classes that still use noteSet()
  noteSet(modeName: string, root: string): void {
    this.itemSet(modeName, root);
  }
}

/**
 * Random mode selection from all available modes.
 * @extends GenericComposer<Mode>
 */
class RandomModeComposer extends (globalThis as any).RandomGenericComposer {
  mode: any; // Backward compatibility alias

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
    this.mode = (globalThis as any).t.Mode.get(`${root} ${modeName}`);
    this.item = this.mode; // Backward compatibility
    this.scale = this.mode; // Backward compatibility
    this.notes = this.mode.notes || this.mode.intervals || [];
    // If mode.notes is still empty, fall back to scale
    if (!this.notes || this.notes.length === 0) {
      const scale = (globalThis as any).t.Scale.get(`${root} ${modeName}`);
      this.notes = scale.notes || [];
    }
  }

  // Backward compatibility alias for index.ts classes that still use noteSet()
  noteSet(modeName: string, root: string): void {
    this.itemSet(modeName, root);
  }
}

// Export to global scope
(globalThis as any).ModeComposer = ModeComposer;
(globalThis as any).RandomModeComposer = RandomModeComposer;
export { ModeComposer, RandomModeComposer };
