/**
 * Generates common harmonic progressions using Roman numeral analysis.
 * @class
 */
declare class ProgressionGenerator {
    constructor(key: string, quality?: string);
    /**
     * @param {string} key - Root key (e.g., 'C', 'Am')
     * @param {string} [quality='major'] - 'major' or 'minor'
     */
    constructor(key: string, quality?: string);
    key: string;
    quality: string;
    scale: import("@tonaljs/scale").Scale;
    romanQuality: any;
    scaleNotes: any;
    diatonicChords: any;
    romanToChord(roman: string): string;
    /**
     * Converts Roman numeral to chord symbol.
     * @param {string} roman - Roman numeral (e.g., 'I', 'ii', 'V7')
     * @returns {string} Chord symbol
     */
    romanToChord(roman: string): string;
    generate(type: string): string[];
    /**
     * Generates common progression patterns.
     * @param {string} type - Progression type
     * @returns {string[]} Array of chord symbols
     */
    generate(type: string): string[];
    random(): string[];
    /**
     * Generates a random common progression.
     * @returns {string[]} Array of chord symbols
     */
    random(): string[];
}
//# sourceMappingURL=ProgressionGenerator.d.ts.map