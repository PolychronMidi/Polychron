/**
 * Voice leading cost function optimizer.
 * Implements soft constraints for smooth voice motion, voice range limits,
 * and leap recovery rules using weighted penalty scoring.
 * @class
 */
declare class VoiceLeadingScore {
    constructor(config?: {});
    weights: {
        smoothMotion: any;
        voiceRange: any;
        leapRecovery: any;
        voiceCrossing: any;
        parallelMotion: any;
    };
    registers: {
        soprano: number[];
        alto: number[];
        tenor: number[];
        bass: number[];
    };
    history: any[];
    maxHistoryDepth: number;
    /**
     * Scores all available notes and returns the best candidate.
     * @param {number[]} lastNotes - Previous notes [soprano, alto, tenor, bass]
     * @param {number[]} availableNotes - Pool of candidate notes to evaluate
     * @param {{ register?: string, constraints?: string[] }} [config] - Voice context
     * @returns {number} Best scoring note
     */
    selectNextNote(lastNotes: number[], availableNotes: number[], config?: {
        register?: string;
        constraints?: string[];
    }): number;
    /**
     * Computes total cost for a candidate note.
     * @private
     * @param {number} candidate - MIDI note to evaluate
     * @param {number[]} lastNotes - Previous notes per voice
     * @param {number[]} registerRange - Valid register [min, max]
     * @param {string[]} constraints - Applied constraints
     * @returns {number} Total weighted cost (lower is better)
     */
    private _scoreCandidate;
    /**
     * Scores voice motion smoothness: small intervals cost less than large leaps.
     * @private
     * @param {number} interval - Semitone distance
     * @param {number} fromNote - Previous note
     * @param {number} toNote - Candidate note
     * @returns {number} Motion cost (0-10)
     */
    private _scoreVoiceMotion;
    /**
     * Scores register appropriateness: penalizes extreme high/low values.
     * @private
     * @param {number} note - MIDI note to evaluate
     * @param {number[]} range - [min, max] register bounds
     * @returns {number} Range cost (0-8)
     */
    private _scoreVoiceRange;
    /**
     * Scores leap recovery: leaps should be followed by stepwise motion in opposite direction.
     * @private
     * @param {number} currentInterval - Current semitone distance
     * @param {number} prevInterval - Previous semitone distance
     * @param {number[]} lastNotes - [n-1, n-2, ...] to check direction
     * @returns {number} Recovery cost (0-5)
     */
    private _scoreLeapRecovery;
    /**
     * Detects voice crossing in multi-voice context.
     * @private
     * @param {number} candidate - Soprano candidate
     * @param {number[]} lastNotes - Last notes [soprano, alto, tenor, bass]
     * @returns {number} Crossing cost (0-6)
     */
    private _scoreVoiceCrossing;
    /**
     * Detects parallel motion in same direction across consecutive intervals.
     * @private
     * @param {number} currentMotion - Current interval direction and size
     * @param {number} lastMotion - Previous interval from history
     * @returns {number} Parallel motion cost (0-3)
     */
    private _scoreParallelMotion;
    /**
     * Updates historical tracking of voice motions for context.
     * @private
     * @param {number} note - Current note selected
     * @param {string} register - Voice register
     */
    private _updateHistory;
    /**
     * Analyzes voice leading quality of a sequence.
     * Useful for post-hoc validation or constraint scoring.
     * @param {number[]} noteSequence - Sequence of notes to analyze
     * @returns {{ smoothness: number, avgRange: number, leapRecoveries: number }}
     */
    analyzeQuality(noteSequence: number[]): {
        smoothness: number;
        avgRange: number;
        leapRecoveries: number;
    };
    /**
     * Resets historical state (useful for starting new sections).
     */
    reset(): void;
}
//# sourceMappingURL=voiceLeading.d.ts.map