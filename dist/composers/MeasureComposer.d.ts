/**
 * Composes meter-related values with randomization.
 * @class
 */
declare class MeasureComposer {
    /** @type {number[]|null} Previous meter [numerator, denominator] */
    lastMeter: number[] | null;
    /** @type {number} Recursion depth counter for getNotes */
    recursionDepth: number;
    /** @type {number} Max allowed recursion depth */
    MAX_RECURSION: number;
    /** @type {VoiceLeadingScore|null} Optional voice leading optimizer */
    voiceLeading: VoiceLeadingScore | null;
    /** @type {number[]} Historical notes for voice leading context */
    voiceHistory: number[];
    getNumerator(): number;
    /** @returns {number} Random numerator from NUMERATOR config */
    getNumerator(): number;
    getDenominator(): number;
    /** @returns {number} Random denominator from DENOMINATOR config */
    getDenominator(): number;
    getDivisions(): number;
    /** @returns {number} Random divisions count from DIVISIONS config */
    getDivisions(): number;
    getSubdivisions(): number;
    /** @returns {number} Random subdivisions count from SUBDIVISIONS config */
    getSubdivisions(): number;
    getSubsubdivs(): number;
    /** @returns {number} Random sub-subdivisions count from SUBSUBDIVS config */
    getSubsubdivs(): number;
    getVoices(): number;
    /** @returns {number} Random voice count from VOICES config */
    getVoices(): number;
    getOctaveRange(): number[];
    /** @returns {number[]} Two octaves with minimum 2-3 octave difference */
    getOctaveRange(): number[];
    getMeter(ignoreRatioCheck?: boolean, polyMeter?: boolean, maxIterations?: number, timeLimitMs?: number): number[];
    /**
     * Generates a valid meter [numerator, denominator] with log-based ratio check.
     * @param {boolean} [ignoreRatioCheck=false] - Skip ratio validation
     * @param {boolean} [polyMeter=false] - Allow larger ratio jumps for polyrhythm
     * @param {number} [maxIterations=200] - Maximum attempts before fallback
     * @param {number} [timeLimitMs=100] - Maximum wall-clock time before fallback
     * @returns {number[]} [numerator, denominator]
     * @throws {Error} When max iterations exceeded and no valid meter found
     */
    getMeter(ignoreRatioCheck?: boolean, polyMeter?: boolean, maxIterations?: number, timeLimitMs?: number): number[];
    getNotes(octaveRange?: number[] | null): {
        note: number;
    }[];
    /**
     * Generates note objects within octave range.
     * @param {number[]|null} [octaveRange=null] - [min, max] octaves, or auto-generate
     * @returns {{note: number}[]} Array of note objects
     */
    getNotes(octaveRange?: number[] | null): {
        note: number;
    }[];
    enableVoiceLeading(scorer?: VoiceLeadingScore): void;
    /**
     * Enables voice leading optimization for this composer.
     * @param {VoiceLeadingScore} [scorer] - Optional custom voice leading scorer
     * @returns {void}
     */
    enableVoiceLeading(scorer?: VoiceLeadingScore): void;
    disableVoiceLeading(): void;
    /**
     * Disables voice leading optimization.
     * @returns {void}
     */
    disableVoiceLeading(): void;
    selectNoteWithLeading(availableNotes: number[], config?: {
        register?: string;
        constraints?: string[];
    }): number;
    /**
     * Selects the best note from available candidates using voice leading cost function.
     * Falls back to random selection if voice leading is disabled.
     * @param {number[]} availableNotes - Pool of candidate notes
     * @param {{ register?: string, constraints?: string[] }} [config] - Voice context
     * @returns {number} Selected note
     */
    selectNoteWithLeading(availableNotes: number[], config?: {
        register?: string;
        constraints?: string[];
    }): number;
    resetVoiceLeading(): void;
    /**
     * Resets voice leading history (call at section boundaries).
     * @returns {void}
     */
    resetVoiceLeading(): void;
}
//# sourceMappingURL=MeasureComposer.d.ts.map