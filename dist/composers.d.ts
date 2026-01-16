/**
 * Composes notes from a chord progression.
 * @extends MeasureComposer
 */
/**
 * Normalizes enharmonic chord symbols to their simplest form.
 * @param {string} chordSymbol - Original chord symbol
 * @returns {string} Normalized chord symbol
 */
declare function normalizeChordSymbol(chordSymbol: string): string;
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
    /** @returns {number} Random numerator from NUMERATOR config */
    getNumerator(): number;
    getNumerator(): number;
    /** @returns {number} Random denominator from DENOMINATOR config */
    getDenominator(): number;
    getDenominator(): number;
    /** @returns {number} Random divisions count from DIVISIONS config */
    getDivisions(): number;
    getDivisions(): number;
    /** @returns {number} Random subdivisions count from SUBDIVISIONS config */
    getSubdivisions(): number;
    getSubdivisions(): number;
    /** @returns {number} Random sub-subdivisions count from SUBSUBDIVS config */
    getSubsubdivs(): number;
    getSubsubdivs(): number;
    /** @returns {number} Random voice count from VOICES config */
    getVoices(): number;
    getVoices(): number;
    /** @returns {number[]} Two octaves with minimum 2-3 octave difference */
    getOctaveRange(): number[];
    getOctaveRange(): number[];
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
    getMeter(ignoreRatioCheck?: boolean, polyMeter?: boolean, maxIterations?: number, timeLimitMs?: number): number[];
    /**
     * Generates note objects within octave range.
     * @param {number[]|null} [octaveRange=null] - [min, max] octaves, or auto-generate
     * @returns {{note: number}[]} Array of note objects
     */
    getNotes(octaveRange?: number[] | null): {
        note: number;
    }[];
    getNotes(octaveRange?: number[] | null): {
        note: number;
    }[];
    /**
     * Enables voice leading optimization for this composer.
     * @param {VoiceLeadingScore} [scorer] - Optional custom voice leading scorer
     * @returns {void}
     */
    enableVoiceLeading(scorer?: VoiceLeadingScore): void;
    enableVoiceLeading(scorer?: VoiceLeadingScore): void;
    /**
     * Disables voice leading optimization.
     * @returns {void}
     */
    disableVoiceLeading(): void;
    disableVoiceLeading(): void;
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
    selectNoteWithLeading(availableNotes: number[], config?: {
        register?: string;
        constraints?: string[];
    }): number;
    /**
     * Resets voice leading history (call at section boundaries).
     * @returns {void}
     */
    resetVoiceLeading(): void;
    resetVoiceLeading(): void;
}
/**
 * Composes notes from a specific scale.
 * @extends MeasureComposer
 */
declare class ScaleComposer extends MeasureComposer {
    /**
     * @param {string} scaleName - e.g., 'major', 'minor'
     * @param {string} root - e.g., 'C', 'D#'
     */
    constructor(scaleName: string, root: string);
    constructor(scaleName: string, root: string);
    root: string;
    /**
     * Sets scale and extracts notes.
     * @param {string} scaleName
     * @param {string} root
     */
    noteSet(scaleName: string, root: string): void;
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
    /** Randomly selects scale and root from venue.js data */
    noteSet(): void;
    noteSet(): void;
    /** @returns {{note: number}[]} Random scale notes */
    x(): {
        note: number;
    }[];
    x(): {
        note: number;
    }[];
}
declare class ChordComposer extends MeasureComposer {
    /**
     * @param {string[]} progression - Array of chord symbols, e.g., ['CM', 'Dm', 'Em']
     */
    constructor(progression: string[]);
    /**
     * Sets progression and validates chords.
     * @param {string[]} progression
     * @param {string} [direction='R'] - 'R' (right), 'L' (left), 'E' (either), '?' (random)
     */
    noteSet(progression: string[], direction?: string): void;
    progression: import("@tonaljs/chord").Chord[];
    currentChordIndex: any;
    notes: string[];
    /** @returns {{note: number}[]} Chord notes */
    x: () => {
        note: number;
    }[];
}
/**
 * Random chord progression from all available chords.
 * @extends ChordComposer
 */
declare class RandomChordComposer extends ChordComposer {
    constructor();
    /** Generates 2-5 random chords */
    noteSet(): void;
}
/**
 * Composes notes from a specific mode.
 * @extends MeasureComposer
 */
declare class ModeComposer extends MeasureComposer {
    /**
     * @param {string} modeName - e.g., 'ionian', 'aeolian'
     * @param {string} root - e.g., 'A', 'C'
     */
    constructor(modeName: string, root: string);
    root: string;
    /**
     * Sets mode and extracts notes.
     * @param {string} modeName
     * @param {string} root
     */
    noteSet(modeName: string, root: string): void;
    mode: import("@tonaljs/mode").Mode;
    notes: string[];
    /** @returns {{note: number}[]} Mode notes */
    x: () => {
        note: number;
    }[];
}
/**
 * Random mode selection from all available modes.
 * @extends ModeComposer
 */
declare class RandomModeComposer extends ModeComposer {
    constructor();
    /** Randomly selects mode and root from venue.js data */
    noteSet(): void;
}
/**
 * Composes notes from pentatonic scales with specialized voicing.
 * Pentatonics avoid semitone intervals, creating open, consonant harmonies.
 * @extends MeasureComposer
 */
/**
 * Generates common harmonic progressions using Roman numeral analysis.
 * @class
 */
declare class ProgressionGenerator {
    /**
     * @param {string} key - Root key (e.g., 'C', 'Am')
     * @param {string} [quality='major'] - 'major' or 'minor'
     */
    constructor(key: string, quality?: string);
    constructor(key: string, quality?: string);
    key: string;
    quality: string;
    scale: import("@tonaljs/scale").Scale;
    romanQuality: any;
    scaleNotes: any;
    diatonicChords: any;
    /**
     * Converts Roman numeral to chord symbol.
     * @param {string} roman - Roman numeral (e.g., 'I', 'ii', 'V7')
     * @returns {string} Chord symbol
     */
    romanToChord(roman: string): string;
    romanToChord(roman: string): string;
    /**
     * Generates common progression patterns.
     * @param {string} type - Progression type
     * @returns {string[]} Array of chord symbols
     */
    generate(type: string): string[];
    generate(type: string): string[];
    /**
     * Generates a random common progression.
     * @returns {string[]} Array of chord symbols
     */
    random(): string[];
    random(): string[];
}
/**
 * Composer that manages harmonic tension and release curves.
 * Uses chord function theory (tonic, subdominant, dominant) to create satisfying progressions.
 * @extends ChordComposer
 */
declare class TensionReleaseComposer extends ChordComposer {
    /**
     * @param {string} key - Root key
     * @param {string} [quality='major'] - 'major' or 'minor'
     * @param {number} [tensionCurve=0.5] - 0 = constant tonic, 1 = high tension
     */
    constructor(key?: string, quality?: string, tensionCurve?: number);
    generator: ProgressionGenerator;
    tensionCurve: any;
    key: string;
    quality: string;
    measureInSection: number;
    /**
     * Calculates harmonic tension level (0 = tonic/stable, 1 = dominant/unstable).
     * @param {string} chordSymbol - Chord to analyze
     * @returns {number} Tension level 0-1
     */
    calculateTension(chordSymbol: string): number;
    /**
     * Selects next chord based on current tension curve position.
     * @param {number} position - Position in phrase (0-1)
     * @returns {string[]} Chord progression for this measure
     */
    selectChordByTension(position: number): string[];
    /**
     * Overrides parent noteSet to implement tension-based progression.
     * @param {string} [direction='tension'] - 'tension' uses curve, others use parent behavior
     */
    noteSet(progression: any, direction?: string): void;
}
/**
 * Composer that borrows chords from parallel modes for color and variety.
 * E.g., in C major, borrow from C minor, C dorian, C mixolydian, etc.
 * @extends ChordComposer
 */
declare class ModalInterchangeComposer extends ChordComposer {
    /**
     * @param {string} key - Root key
     * @param {string} [primaryMode='major'] - Primary mode ('major' or 'minor')
     * @param {number} [borrowProbability=0.25] - Chance to borrow (0-1)
     */
    constructor(key?: string, primaryMode?: string, borrowProbability?: number);
    key: string;
    primaryMode: string;
    borrowProbability: any;
    generator: ProgressionGenerator;
    borrowModes: string[];
    /**
     * Borrows a chord from a parallel mode.
     * @returns {string} Borrowed chord symbol
     */
    borrowChord(): string;
    /**
     * Overrides parent noteSet to occasionally substitute borrowed chords.
     * @param {string[]} [progression] - Optional progression override
     * @param {string} [direction='R'] - Progression direction
     */
    noteSet(progression?: string[], direction?: string): void;
}
/**
 * Harmonic rhythm control - changes chords at specified measure intervals.
 * Implements Phase 2.2: Dynamic Harmonic Progressions
 * @extends ChordComposer
 */
declare class HarmonicRhythmComposer extends ChordComposer {
    /**
     * @param {string} [progression=['I','IV','V','I']] - Progression as roman numerals or chord symbols
     * @param {string} [key='C'] - Root key for roman numeral conversion
     * @param {number} [measuresPerChord=2] - How many measures each chord lasts (1-8)
     * @param {string} [quality='major'] - 'major' or 'minor' for key context
     */
    constructor(progression?: string, key?: string, measuresPerChord?: number, quality?: string);
    key: string;
    quality: string;
    measuresPerChord: any;
    measureCount: number;
    generator: ProgressionGenerator;
    /**
     * Calculate which chord should play at current measure.
     * @returns {string} Current chord symbol
     */
    getCurrentChord(): string;
    /**
     * Overrides parent to return current chord based on harmonic rhythm.
     * @param {string[]} [progression] - Optional override
     * @param {string} [direction='R'] - Direction (unused, harmonic rhythm controls)
     */
    /**
     * Overrides parent to return current chord based on harmonic rhythm.
     * @param {string[]} [progression] - Optional override
     * @param {string} [direction='R'] - Direction (unused, harmonic rhythm controls)
     */
    noteSet(progression?: string[], direction?: string): void;
    /**
     * Set harmonic rhythm (measures per chord).
     * @param {number} measures - Measures each chord lasts
     */
    setHarmonicRhythm(measures: number): void;
    /**
     * Change to a new progression at next chord boundary.
     * @param {string[]} newProgression - New chord progression
     */
    changeProgression(newProgression: string[]): void;
    /** @returns {{note: number}[]} Harmonic rhythm notes */
    getNotes(octaveRange: any): {
        note: number;
    }[];
}
/**
 * Phase 2.3: Melodic Development
 * Develops melodies through motif transformations and call-and-response patterns.
 * Extends ScaleComposer to apply motif-based development to scale-derived melodies.
 * @extends ScaleComposer
 */
declare class MelodicDevelopmentComposer extends ScaleComposer {
    /**
     * @param {string} [name='major'] - Scale name (major, minor, pentatonic, etc.)
     * @param {string} [root='C'] - Root note
     * @param {number} [developmentIntensity=0.5] - How aggressively to transform (0-1)
     */
    constructor(name?: string, root?: string, developmentIntensity?: number);
    developmentIntensity: any;
    motifPhase: number;
    measureCount: number;
    responseMode: boolean;
    transpositionOffset: number;
    /**
     * Overrides parent to apply motif-based transformations to generated notes.
     * Cycles through original, transposed, inverted, and retrograde variations.
     */
    getNotes(octaveRange: any): {
        note: number;
    }[];
    /**
     * Set development intensity (0=minimal transformation, 1=maximum variation).
     * @param {number} intensity - Development intensity level
     */
    setDevelopmentIntensity(intensity: number): void;
    /**
     * Reset motif phase to beginning for new section.
     */
    resetMotifPhase(): void;
}
/**
 * Phase 2.4: Advanced Voice Leading
 * Extends voice leading with figured bass analysis and common-tone retention.
 * Creates more sophisticated chord voicings with smooth voice motion.
 * @extends ScaleComposer
 */
declare class AdvancedVoiceLeadingComposer extends ScaleComposer {
    /**
     * @param {string} [name='major'] - Scale name
     * @param {string} [root='C'] - Root note
     * @param {number} [commonToneWeight=0.7] - Priority for common-tone retention (0-1)
     */
    constructor(name?: string, root?: string, commonToneWeight?: number);
    commonToneWeight: any;
    previousNotes: any[];
    voiceBalanceThreshold: number;
    contraryMotionPreference: number;
    /**
     * Analyzes and selects notes with voice leading awareness.
     * Prioritizes common tones and smooth voice motion.
     */
    getNotes(octaveRange: any): any[];
    /**
     * Optimizes voicing by retaining common tones and avoiding large leaps.
     * @private
     */
    private optimizeVoiceLeading;
    /**
     * Set priority for common-tone retention.
     * @param {number} weight - 0-1 where 1 = always retain common tones
     */
    setCommonToneWeight(weight: number): void;
    /**
     * Set preference for contrary motion (opposite direction movement between voices).
     * @param {number} probability - 0-1 probability of using contrary motion
     */
    setContraryMotionPreference(probability: number): void;
    /**
     * Analyze figured bass for current voicing (simplified version).
     * Returns bass note and interval stack above it.
     * @private
     */
    private analyzeFiguredBass;
}
declare class PentatonicComposer extends MeasureComposer {
    /**
     * @param {string} [root='C'] - Root note
     * @param {string} [type='major'] - 'major' (1-2-3-5-6) or 'minor' (1-b3-4-5-b7)
     */
    constructor(root?: string, type?: string);
    root: string;
    type: string;
    /**
     * Sets pentatonic scale notes.
     * @param {string} root - Root note
     * @param {string} type - 'major' or 'minor'
     */
    noteSet(root: string, type?: string): void;
    scale: import("@tonaljs/scale").Scale;
    notes: string[];
    /**
     * Generates pentatonic notes with open voicing preference.
     * @param {number[]|null} [octaveRange=null] - [min, max] octaves
     * @returns {{note: number}[]} Array of note objects
     */
    getNotes(octaveRange?: number[] | null): {
        note: number;
    }[];
    /** @returns {{note: number}[]} Pentatonic notes */
    x: () => {
        note: number;
    }[];
}
/**
 * Random pentatonic scale selection.
 * @extends PentatonicComposer
 */
declare class RandomPentatonicComposer extends PentatonicComposer {
    constructor();
    /** Randomly selects pentatonic type and root */
    noteSet(): void;
}
declare class ComposerFactory {
    static constructors: {
        measure: () => MeasureComposer;
        scale: ({ name, root }?: {
            name?: string;
            root?: string;
        }) => ScaleComposer;
        chords: ({ progression }?: {
            progression?: string[];
        }) => ChordComposer;
        mode: ({ name, root }?: {
            name?: string;
            root?: string;
        }) => ModeComposer;
        pentatonic: ({ root, scaleType }?: {
            root?: string;
            scaleType?: string;
        }) => PentatonicComposer;
        tensionRelease: ({ key, quality, tensionCurve }?: {
            key?: string;
            quality?: string;
            tensionCurve?: number;
        }) => TensionReleaseComposer;
        modalInterchange: ({ key, primaryMode, borrowProbability }?: {
            key?: string;
            primaryMode?: string;
            borrowProbability?: number;
        }) => ModalInterchangeComposer;
        harmonicRhythm: ({ progression, key, measuresPerChord, quality }?: {
            progression?: string[];
            key?: string;
            measuresPerChord?: number;
            quality?: string;
        }) => HarmonicRhythmComposer;
        melodicDevelopment: ({ name, root, developmentIntensity }?: {
            name?: string;
            root?: string;
            developmentIntensity?: number;
        }) => MelodicDevelopmentComposer;
        advancedVoiceLeading: ({ name, root, commonToneWeight }?: {
            name?: string;
            root?: string;
            commonToneWeight?: number;
        }) => AdvancedVoiceLeadingComposer;
    };
    /**
     * Creates a composer instance from a config entry.
     * @param {{ type?: string, name?: string, root?: string, progression?: string[], key?: string, quality?: string, tensionCurve?: number, primaryMode?: string, borrowProbability?: number }} config
     * @returns {MeasureComposer}
     */
    static create(config?: {
        type?: string;
        name?: string;
        root?: string;
        progression?: string[];
        key?: string;
        quality?: string;
        tensionCurve?: number;
        primaryMode?: string;
        borrowProbability?: number;
    }): MeasureComposer;
    static create(config?: {
        type?: string;
        name?: string;
        root?: string;
        progression?: string[];
        key?: string;
        quality?: string;
        tensionCurve?: number;
        primaryMode?: string;
        borrowProbability?: number;
    }): MeasureComposer;
}
//# sourceMappingURL=composers.d.ts.map