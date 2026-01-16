/**
 * Note event structure
 */
interface NoteEvent {
    note: number;
    duration: number;
}
/**
 * Motif class for melodic transformations and development
 */
declare class Motif {
    sequence: NoteEvent[];
    defaultDuration: number;
    /**
     * Create a new Motif
     * @param sequence - Array of notes or note events
     * @param options - Configuration options
     */
    constructor(sequence?: Array<number | {
        note?: number;
        duration?: number;
    }>, options?: {
        defaultDuration?: number;
    });
    /**
     * Returns a deep-copied sequence.
     * @returns Array of note events
     */
    get events(): NoteEvent[];
    /**
     * Transpose motif by semitones.
     * @param semitones - Number of semitones to transpose
     * @returns New transposed Motif
     */
    transpose(semitones?: number): Motif;
    /**
     * Invert motif around a pivot (default: first note).
     * @param pivot - Pivot note for inversion (null = use first note)
     * @returns New inverted Motif
     */
    invert(pivot?: number | null): Motif;
    /**
     * Augment durations by factor.
     * @param factor - Multiplication factor
     * @returns New augmented Motif
     */
    augment(factor?: number): Motif;
    /**
     * Diminish durations by factor.
     * @param factor - Division factor
     * @returns New diminished Motif
     */
    diminish(factor?: number): Motif;
    /**
     * Reverse motif order.
     * @returns New reversed Motif
     */
    reverse(): Motif;
    /**
     * Apply a small development chain: transpose, optional inversion, optional reverse, optional scaling.
     * @param options - Development options
     * @returns New developed Motif
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
     * @param notes - Array of note objects
     * @param options - Clamping options
     * @returns New array of adjusted notes
     */
    applyToNotes(notes?: Array<{
        note?: number;
        [key: string]: any;
    }>, options?: {
        clampMin?: number;
        clampMax?: number;
    }): Array<{
        note: number;
        [key: string]: any;
    }>;
}
export { Motif };
//# sourceMappingURL=motifs.d.ts.map