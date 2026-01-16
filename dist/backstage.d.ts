declare const m: Math;
/**
 * Clamp a value within [min, max] range.
 * @param value - Value to clamp.
 * @param min - Minimum allowed value.
 * @param max - Maximum allowed value.
 * @returns Clamped value.
 */
declare const clamp: (value: number, min: number, max: number) => number;
/**
 * Modulo-based clamp: Value wraps around within range.
 */
declare const modClamp: (value: number, min: number, max: number) => number;
/**
 * Regular clamp at high end, modClamp at low end.
 */
declare const lowModClamp: (value: number, min: number, max: number) => number;
/**
 * Regular clamp at low end, modClamp at high end.
 */
declare const highModClamp: (value: number, min: number, max: number) => number;
/**
 * Scale-based clamp with dynamic bounds.
 */
declare const scaleClamp: (value: number, min: number, max: number, factor: number, maxFactor?: number, base?: number) => number;
/**
 * Scale-based clamp with explicit bounds.
 */
declare const scaleBoundClamp: (value: number, base: number, lowerScale: number, upperScale: number, minBound?: number, maxBound?: number) => number;
/**
 * Soft clamp with gradual boundary approach.
 */
declare const softClamp: (value: number, min: number, max: number, softness?: number) => number;
/**
 * Step-based clamp: Snaps value to nearest step.
 */
declare const stepClamp: (value: number, min: number, max: number, step: number) => number;
/**
 * Logarithmic clamp for exponential value ranges.
 */
declare const logClamp: (value: number, min: number, max: number, base?: number) => number;
/**
 * Exponential clamp for logarithmic value ranges.
 */
declare const expClamp: (value: number, min: number, max: number, base?: number) => number;
/**
 * Random Float (decimal) inclusive of min(s) & max(s).
 */
declare const rf: (min1?: number, max1?: number, min2?: number, max2?: number) => number;
declare const randomFloat: (min1?: number, max1?: number, min2?: number, max2?: number) => number;
/**
 * Random Integer (whole number) inclusive of min(s) & max(s).
 */
declare const ri: (min1?: number, max1?: number, min2?: number, max2?: number) => number;
declare const randomInt: (min1?: number, max1?: number, min2?: number, max2?: number) => number;
/**
 * Random Limited Change: Random value from inclusive range, with limited change per iteration.
 */
declare const rl: (currentValue: number, minChange: number, maxChange: number, minValue: number, maxValue: number, type?: string) => number;
declare const randomLimitedChange: (currentValue: number, minChange: number, maxChange: number, minValue: number, maxValue: number, type?: string) => number;
/**
 * Random variation within range(s) at frequency.
 */
declare const rv: (value: number, boostRange?: number[], frequency?: number, deboostRange?: number[]) => number;
declare const randomVariation: (value: number, boostRange?: number[], frequency?: number, deboostRange?: number[]) => number;
/**
 * Normalize Weights: Any sized list of weights with any values are normalized to fit inclusive range.
 */
declare const normalizeWeights: (weights: number[], min: number, max: number, variationLow?: number, variationHigh?: number) => number[];
/**
 * Random weighted selection in inclusive range.
 */
declare const rw: (min: number, max: number, weights: number[]) => number;
declare const randomWeightedInRange: (min: number, max: number, weights: number[]) => number;
/**
 * Random weighted selection from array.
 */
declare const randomWeightedInArray: (weights: number[]) => number;
/**
 * Random weighted selection from options object.
 */
declare const randomWeightedSelection: (options: any) => string;
/**
 * Provide params as a function for range, otherwise returns random value from array.
 */
declare const ra: (v: any) => any;
declare const randomInRangeOrArray: (v: any) => any;
declare let measureCount: number, subsubdivStart: number, subdivStart: number, divStart: number, beatCount: number, noteCount: number;
/**
 * Neutral pitch bend value (center of pitch bend range).
 */
declare const neutralPitchBend = 8192;
/**
 * Semitone value in pitch bend units.
 */
declare const semitone: number;
declare const cCH1 = 0, cCH2 = 1, lCH1 = 2, rCH1 = 3, lCH3 = 4, rCH3 = 5, lCH2 = 6, rCH2 = 7, lCH4 = 8, drumCH = 9, rCH4 = 10, cCH3 = 11, lCH5 = 12, rCH5 = 13, lCH6 = 14, rCH6 = 15;
declare const bass: number[];
declare const bassBinaural: number[];
declare const source: number[];
declare const source2: number[];
declare const reflection: number[];
declare const reflectionBinaural: number[];
declare const reflect: {
    [key: number]: number;
};
declare const reflect2: {
    [key: number]: number;
};
declare const binauralL: number[];
declare const binauralR: number[];
declare const flipBinF: number[];
declare const flipBinT: number[];
declare const flipBinF2: number[];
declare const flipBinT2: number[];
declare const flipBinF3: number[];
declare const flipBinT3: number[];
declare const stutterFadeCHs: number[];
declare const allCHs: number[];
declare const stutterPanCHs: number[];
declare const FX: number[];
/**
 * Send All Notes Off CC (123) to prevent sustain across transitions.
 */
declare const allNotesOff: (tick?: number) => any[];
/**
 * Send Mute All CC (120) to silence all channels.
 */
declare const muteAll: (tick?: number) => any[];
export { clamp, modClamp, lowModClamp, highModClamp, scaleClamp, scaleBoundClamp, softClamp, stepClamp, logClamp, expClamp, rf, randomFloat, ri, randomInt, rl, randomLimitedChange, rv, randomVariation, rw, randomWeightedInRange, ra, randomInRangeOrArray, normalizeWeights, randomWeightedInArray, randomWeightedSelection, cCH1, cCH2, cCH3, lCH1, rCH1, lCH2, rCH2, lCH3, rCH3, lCH4, rCH4, lCH5, rCH5, lCH6, rCH6, drumCH, bass, bassBinaural, source, source2, reflection, reflectionBinaural, reflect, reflect2, binauralL, binauralR, flipBinF, flipBinT, flipBinF2, flipBinT2, flipBinF3, flipBinT3, stutterFadeCHs, allCHs, stutterPanCHs, FX, allNotesOff, muteAll, neutralPitchBend, semitone, measureCount, beatCount, noteCount, divStart, subdivStart, subsubdivStart, m };
declare global {
    var m: any;
    var clamp: any;
    var modClamp: any;
    var rf: any;
    var ri: any;
    var rw: any;
    var rv: any;
    var rl: any;
    var ra: any;
    var measureCount: number;
    var beatCount: number;
    var divStart: number;
    var subdivStart: number;
}
//# sourceMappingURL=backstage.d.ts.map