export class Motif {
    /**
     * @param {Array<number|{note:number,duration?:number}>} sequence
     * @param {{defaultDuration?:number}} [options]
     */
    constructor(sequence?: Array<number | {
        note: number;
        duration?: number;
    }>, options?: {
        defaultDuration?: number;
    });
    sequence: {
        note: number;
        duration: number;
    }[];
    /** @type {number} */
    defaultDuration: number;
    /**
     * Returns a deep-copied sequence.
     * @returns {{note:number,duration:number}[]}
     */
    get events(): {
        note: number;
        duration: number;
    }[];
    /**
     * Transpose motif by semitones.
     * @param {number} semitones
     * @returns {Motif}
     */
    transpose(semitones?: number): Motif;
    /**
     * Invert motif around a pivot (default: first note).
     * @param {number|null} [pivot]
     * @returns {Motif}
     */
    invert(pivot?: number | null): Motif;
    /**
     * Augment durations by factor.
     * @param {number} factor
     * @returns {Motif}
     */
    augment(factor?: number): Motif;
    /**
     * Diminish durations by factor.
     * @param {number} factor
     * @returns {Motif}
     */
    diminish(factor?: number): Motif;
    /**
     * Reverse motif order.
     * @returns {Motif}
     */
    reverse(): Motif;
    /**
     * Apply a small development chain: transpose, optional inversion, optional reverse, optional scaling.
     * @param {{transposeBy?:number,invertPivot?:number|false,reverse?:boolean,scale?:number}} [options]
     * @returns {Motif}
     */
    develop(options?: {
        transposeBy?: number;
        invertPivot?: number | false;
        reverse?: boolean;
        scale?: number;
    }): Motif;
    /**
     * Apply motif offsets to an array of note objects (non-mutating).
     * Calculates interval offset from motif's first note and applies to each input note.
     * @param {{note:number}[]} notes
     * @param {{clampMin?:number,clampMax?:number}} [options]
     * @returns {{note:number}[]}
     */
    applyToNotes(notes?: {
        note: number;
    }[], options?: {
        clampMin?: number;
        clampMax?: number;
    }): {
        note: number;
    }[];
}
//# sourceMappingURL=motifs.d.ts.map