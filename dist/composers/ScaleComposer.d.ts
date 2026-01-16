/**
 * Composes notes from a specific scale.
 * @extends MeasureComposer
 */
declare class ScaleComposer extends MeasureComposer {
    constructor(scaleName: string, root: string);
    /**
     * @param {string} scaleName - e.g., 'major', 'minor'
     * @param {string} root - e.g., 'C', 'D#'
     */
    constructor(scaleName: string, root: string);
    root: string;
    noteSet(scaleName: string, root: string): void;
    /**
     * Sets scale and extracts notes.
     * @param {string} scaleName
     * @param {string} root
     */
    noteSet(scaleName: string, root: string): void;
    scale: import("@tonaljs/scale").Scale;
    notes: string[];
    /** @returns {{note: number}[]} Scale notes */
    x: () => {
        note: number;
    }[];
}
/**
 * Random scale selection from all available scales.
 * @extends ScaleComposer
 */
declare class RandomScaleComposer extends ScaleComposer {
    constructor();
    constructor();
    noteSet(): void;
    /** Randomly selects scale and root from venue.js data */
    noteSet(): void;
    x(): {
        note: number;
    }[];
    /** @returns {{note: number}[]} Random scale notes */
    x(): {
        note: number;
    }[];
}
//# sourceMappingURL=ScaleComposer.d.ts.map