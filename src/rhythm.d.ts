/**
 * Type for drum configuration
 */
interface DrumInfo {
    note: number;
    velocityRange: [number, number];
}
/**
 * Type for drum map
 */
interface DrumMap {
    [key: string]: DrumInfo;
}
/**
 * Drum sound mapping with MIDI notes and velocities
 */
export declare const drumMap: DrumMap;
/**
 * Generate drum pattern for a beat.
 * @param {string|string[]} drumNames - Drum name(s) or 'random'.
 * @param {number|number[]} beatOffsets - Offset(s) within the beat.
 * @param {number} [offsetJitter=rf(.1)] - Random offset jitter amount.
 * @param {number} [stutterChance=.3] - Probability of stutter effect.
 * @param {number[]} [stutterRange=[2,ri(1,11)]] - Range of stutter counts.
 * @param {number} [stutterDecayFactor=rf(.9,1.1)] - Velocity decay per stutter.
 * @returns {void}
 */
export declare const drummer: (drumNames: string | string[], beatOffsets?: number | number[], offsetJitter?: number, stutterChance?: number, stutterRange?: number[], stutterDecayFactor?: number) => void;
/**
 * Play drums for primary meter (beat index 0-3 pattern).
 * @returns {void}
 */
export declare const playDrums: () => void;
/**
 * Play drums for poly meter (different pattern from primary).
 * @returns {void}
 */
export declare const playDrums2: () => void;
/**
 * Rhythm pattern configuration
 */
interface RhythmConfig {
    weights: number[];
    method: string;
    args: (length: number, pattern?: number[]) => any[];
}
/**
 * Rhythm patterns library with weighted selection.
 */
export declare const rhythms: {
    [key: string]: RhythmConfig;
};
/**
 * Generate binary rhythm pattern.
 * @param {number} length - Target pattern length.
 * @returns {number[]} Binary rhythm pattern.
 */
export declare const binary: (length: number) => number[];
/**
 * Generate hexadecimal rhythm pattern.
 * @param {number} length - Target pattern length.
 * @returns {number[]} Hex rhythm pattern.
 */
export declare const hex: (length: number) => number[];
/**
 * Generate onsets rhythm pattern.
 * @param {number|Object} numbers - Number or config object.
 * @returns {number[]} Onsets pattern.
 */
export declare const onsets: (numbers: number | any) => number[];
/**
 * Generate random rhythm with probability.
 * @param {number} length - Pattern length.
 * @param {number} probOn - Probability of "on" (1) notes.
 * @returns {number[]} Random pattern.
 */
export declare const random: (length: number, probOn: number) => number[];
/**
 * Generate probability-based rhythm.
 * @param {number[]} probs - Probability array.
 * @returns {number[]} Probability pattern.
 */
export declare const prob: (probs: number[]) => number[];
/**
 * Generate Euclidean rhythm pattern.
 * @param {number} length - Pattern length.
 * @param {number} ones - Number of "on" beats.
 * @returns {number[]} Euclidean pattern.
 */
export declare const euclid: (length: number, ones: number) => number[];
/**
 * Rotate rhythm pattern.
 * @param {number[]} pattern - Pattern to rotate.
 * @param {number} rotations - Number of rotations.
 * @param {string} [direction='R'] - 'L' (left), 'R' (right), or '?' (random).
 * @param {number} [length=pattern.length] - Output length.
 * @returns {number[]} Rotated pattern.
 */
export declare const rotate: (pattern: number[], rotations: number, direction?: string, length?: number) => number[];
/**
 * Morph rhythm pattern by adjusting probabilities.
 * @param {number[]} pattern - Pattern to morph.
 * @param {string} [direction='both'] - 'up', 'down', 'both', or '?'.
 * @param {number} [length=pattern.length] - Output length.
 * @param {number} [probLow=.1] - Low probability bound.
 * @param {number} [probHigh] - High probability bound (defaults to probLow).
 * @returns {number[]} Morphed pattern.
 */
export declare const morph: (pattern: number[], direction?: string, length?: number, probLow?: number, probHigh?: number) => number[];
/**
 * Set rhythm for a given level.
 * @param {string} level - 'beat', 'div', or 'subdiv'.
 * @returns {number[]} Rhythm pattern for the level.
 * @throws {Error} If invalid level provided.
 */
export declare const setRhythm: (level: string) => number[];
/**
 * Create custom onsets pattern.
 * @param {number} length - Target length.
 * @param {number|number[]|function} valuesOrRange - Onset values or range.
 * @returns {number[]} Onset pattern.
 */
export declare const makeOnsets: (length: number, valuesOrRange: number | number[] | (() => number[])) => number[];
/**
 * Adjust pattern to desired length.
 * @param {number[]} pattern - Input pattern.
 * @param {number} [length] - Target length.
 * @returns {number[]} Pattern adjusted to length.
 */
export declare const patternLength: (pattern: number[], length?: number) => number[];
/**
 * Find closest divisor to target value.
 * @param {number} x - Value to find divisor for.
 * @param {number} [target=2] - Target divisor value.
 * @returns {number} Closest divisor.
 */
export declare const closestDivisor: (x: number, target?: number) => number;
/**
 * Get rhythm using weighted selection or specific method.
 * @param {string} level - Rhythm level ('beat', 'div', 'subdiv').
 * @param {number} length - Pattern length.
 * @param {number[]} pattern - Current pattern.
 * @param {string} [method] - Specific rhythm method to use.
 * @param {...*} [args] - Arguments for the method.
 * @returns {number[]} Rhythm pattern.
 */
export declare const getRhythm: (level: string, length: number, pattern: number[], method?: string, ...args: any[]) => number[] | null;
/**
 * Track beat rhythm state (on/off).
 * @returns {void}
 */
export declare const trackBeatRhythm: () => void;
/**
 * Track division rhythm state (on/off).
 * @returns {void}
 */
export declare const trackDivRhythm: () => void;
/**
 * Track subdivision rhythm state (on/off).
 * @returns {void}
 */
export declare const trackSubdivRhythm: () => void;
/**
 * Track sub-subdivision rhythm state (on/off).
 * @returns {void}
 */
export declare const trackSubsubdivRhythm: () => void;
export {};
//# sourceMappingURL=rhythm.d.ts.map