"use strict";
// @ts-check
// ScaleComposer - Composes notes from specific scales
/**
 * Composes notes from a specific scale.
 * @extends MeasureComposer
 */
class ScaleComposer extends MeasureComposer {
    /**
     * @param {string} scaleName - e.g., 'major', 'minor'
     * @param {string} root - e.g., 'C', 'D#'
     */
    constructor(scaleName, root) {
        super();
        /** @returns {{note: number}[]} Scale notes */
        this.x = () => this.getNotes();
        this.root = root;
        this.noteSet(scaleName, root);
    }
    /**
     * Sets scale and extracts notes.
     * @param {string} scaleName
     * @param {string} root
     */
    noteSet(scaleName, root) {
        this.scale = t.Scale.get(`${root} ${scaleName}`);
        this.notes = this.scale.notes;
    }
}
/**
 * Random scale selection from all available scales.
 * @extends ScaleComposer
 */
class RandomScaleComposer extends ScaleComposer {
    constructor() {
        super('', '');
        this.noteSet();
    }
    /** Randomly selects scale and root from venue.js data */
    noteSet() {
        const randomScale = allScales[ri(allScales.length - 1)];
        const randomRoot = allNotes[ri(allNotes.length - 1)];
        super.noteSet(randomScale, randomRoot);
    }
    /** @returns {{note: number}[]} Random scale notes */
    x() { this.noteSet(); return super.x(); }
}
//# sourceMappingURL=ScaleComposer.js.map