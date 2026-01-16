"use strict";
// backstage.ts - Core utilities, randomization, and MIDI infrastructure.
// minimalist comments, details at: backstage.md
Object.defineProperty(exports, "__esModule", { value: true });
exports.binauralL = exports.reflect2 = exports.reflect = exports.reflectionBinaural = exports.reflection = exports.source2 = exports.source = exports.bassBinaural = exports.bass = exports.drumCH = exports.rCH6 = exports.lCH6 = exports.rCH5 = exports.lCH5 = exports.rCH4 = exports.lCH4 = exports.rCH3 = exports.lCH3 = exports.rCH2 = exports.lCH2 = exports.rCH1 = exports.lCH1 = exports.cCH3 = exports.cCH2 = exports.cCH1 = exports.randomWeightedSelection = exports.randomWeightedInArray = exports.normalizeWeights = exports.randomInRangeOrArray = exports.ra = exports.randomWeightedInRange = exports.rw = exports.randomVariation = exports.rv = exports.randomLimitedChange = exports.rl = exports.randomInt = exports.ri = exports.randomFloat = exports.rf = exports.expClamp = exports.logClamp = exports.stepClamp = exports.softClamp = exports.scaleBoundClamp = exports.scaleClamp = exports.highModClamp = exports.lowModClamp = exports.modClamp = exports.clamp = void 0;
exports.m = exports.subsubdivStart = exports.subdivStart = exports.divStart = exports.noteCount = exports.beatCount = exports.measureCount = exports.semitone = exports.neutralPitchBend = exports.muteAll = exports.allNotesOff = exports.FX = exports.stutterPanCHs = exports.allCHs = exports.stutterFadeCHs = exports.flipBinT3 = exports.flipBinF3 = exports.flipBinT2 = exports.flipBinF2 = exports.flipBinT = exports.flipBinF = exports.binauralR = void 0;
const m = Math;
exports.m = m;
/**
 * Clamp a value within [min, max] range.
 * @param value - Value to clamp.
 * @param min - Minimum allowed value.
 * @param max - Maximum allowed value.
 * @returns Clamped value.
 */
const clamp = (value, min, max) => {
    if (min > max)
        [min, max] = [max, min];
    return m.min(m.max(value, min), max);
};
exports.clamp = clamp;
/**
 * Modulo-based clamp: Value wraps around within range.
 */
const modClamp = (value, min, max) => {
    if (min > max)
        [min, max] = [max, min];
    const range = max - min + 1;
    if (range <= 0)
        return min;
    return ((value - min) % range + range) % range + min;
};
exports.modClamp = modClamp;
/**
 * Regular clamp at high end, modClamp at low end.
 */
const lowModClamp = (value, min, max) => {
    if (value >= max)
        return max;
    else if (value < min)
        return modClamp(value, min, max);
    else
        return value;
};
exports.lowModClamp = lowModClamp;
/**
 * Regular clamp at low end, modClamp at high end.
 */
const highModClamp = (value, min, max) => {
    if (value <= min)
        return min;
    else if (value > max)
        return modClamp(value, min, max);
    else
        return value;
};
exports.highModClamp = highModClamp;
/**
 * Scale-based clamp with dynamic bounds.
 */
const scaleClamp = (value, min, max, factor, maxFactor = factor, base = value) => {
    const scaledMin = m.max(min * factor, min);
    const scaledMax = m.min(max * maxFactor, max);
    const lowerBound = m.max(min, m.floor(base * factor));
    const upperBound = m.min(max, m.ceil(base * maxFactor));
    return clamp(value, lowerBound, upperBound);
};
exports.scaleClamp = scaleClamp;
/**
 * Scale-based clamp with explicit bounds.
 */
const scaleBoundClamp = (value, base, lowerScale, upperScale, minBound = 2, maxBound = 9) => {
    let lowerBound = m.max(minBound, m.floor(base * lowerScale));
    let upperBound = m.min(maxBound, m.ceil(base * upperScale));
    if (lowerBound > upperBound)
        lowerBound = upperBound;
    return clamp(value, lowerBound, upperBound);
};
exports.scaleBoundClamp = scaleBoundClamp;
/**
 * Soft clamp with gradual boundary approach.
 */
const softClamp = (value, min, max, softness = 0.1) => {
    if (value < min)
        return min + (value - min) * softness;
    if (value > max)
        return max - (value - max) * softness;
    return value;
};
exports.softClamp = softClamp;
/**
 * Step-based clamp: Snaps value to nearest step.
 */
const stepClamp = (value, min, max, step) => {
    const clampedValue = clamp(m.round(value / step) * step, min, max);
    return clampedValue;
};
exports.stepClamp = stepClamp;
/**
 * Logarithmic clamp for exponential value ranges.
 */
const logClamp = (value, min, max, base = 10) => {
    const logMin = m.log(min) / m.log(base);
    const logMax = m.log(max) / m.log(base);
    const logValue = m.log(m.max(value, min)) / m.log(base);
    return m.pow(base, m.min(m.max(logValue, logMin), logMax));
};
exports.logClamp = logClamp;
/**
 * Exponential clamp for logarithmic value ranges.
 */
const expClamp = (value, min, max, base = m.E) => {
    const minExp = m.pow(base, min);
    const maxExp = m.pow(base, max);
    const valueExp = m.pow(base, value);
    return m.log(m.min(m.max(valueExp, minExp), maxExp)) / m.log(base);
};
exports.expClamp = expClamp;
/**
 * Random Float (decimal) inclusive of min(s) & max(s).
 */
const rf = (min1 = 1, max1, min2, max2) => {
    if (max1 === undefined) {
        max1 = min1;
        min1 = 0;
    }
    [min1, max1] = [m.min(min1, max1), m.max(min1, max1)];
    if (min2 !== undefined && max2 !== undefined) {
        [min2, max2] = [m.min(min2, max2), m.max(min2, max2)];
        const range1 = max1 - min1;
        const range2 = max2 - min2;
        const totalRange = range1 + range2;
        const rand = m.random() * totalRange;
        if (rand < range1)
            return m.random() * (range1 + Number.EPSILON) + min1;
        else
            return m.random() * (range2 + Number.EPSILON) + min2;
    }
    else
        return m.random() * (max1 - min1 + Number.EPSILON) + min1;
};
exports.rf = rf;
const randomFloat = rf;
exports.randomFloat = randomFloat;
/**
 * Random Integer (whole number) inclusive of min(s) & max(s).
 */
const ri = (min1 = 1, max1, min2, max2) => {
    if (max1 === undefined) {
        max1 = min1;
        min1 = 0;
    }
    [min1, max1] = [m.min(min1, max1), m.max(min1, max1)];
    if (min2 !== undefined && max2 !== undefined) {
        [min2, max2] = [m.min(min2, max2), m.max(min2, max2)];
        const range1 = max1 - min1;
        const range2 = max2 - min2;
        const totalRange = range1 + range2;
        const rand = rf() * totalRange;
        if (rand < range1)
            return clamp(m.round(rf() * range1 + min1), m.ceil(min1), m.floor(max1));
        else
            return clamp(m.round(rand - range1 + min2), m.ceil(min2), m.floor(max2));
    }
    else
        return clamp(m.round(rf() * (max1 - min1) + min1), m.ceil(min1), m.floor(max1));
};
exports.ri = ri;
const randomInt = ri;
exports.randomInt = randomInt;
/**
 * Random Limited Change: Random value from inclusive range, with limited change per iteration.
 */
const rl = (currentValue, minChange, maxChange, minValue, maxValue, type = 'i') => {
    const adjustedMinChange = m.min(minChange, maxChange);
    const adjustedMaxChange = m.max(minChange, maxChange);
    const newMin = m.max(minValue, currentValue + adjustedMinChange);
    const newMax = m.min(maxValue, currentValue + adjustedMaxChange);
    return type === 'f' ? rf(newMin, newMax) : ri(newMin, newMax);
};
exports.rl = rl;
const randomLimitedChange = rl;
exports.randomLimitedChange = randomLimitedChange;
/**
 * Random variation within range(s) at frequency.
 */
const rv = (value, boostRange = [.05, .10], frequency = .05, deboostRange = boostRange) => {
    let factor;
    const singleRange = Array.isArray(deboostRange) ? deboostRange : boostRange;
    const isSingleRange = singleRange.length === 2 && typeof singleRange[0] === 'number' && typeof singleRange[1] === 'number';
    if (isSingleRange) {
        const variation = rf(...singleRange);
        factor = rf() < frequency ? 1 + variation : 1;
    }
    else {
        const range = rf() < .5 ? boostRange : deboostRange;
        factor = rf() < frequency ? 1 + rf(...range) : 1;
    }
    return value * factor;
};
exports.rv = rv;
const randomVariation = rv;
exports.randomVariation = randomVariation;
/**
 * Normalize Weights: Any sized list of weights with any values are normalized to fit inclusive range.
 */
const normalizeWeights = (weights, min, max, variationLow = .7, variationHigh = 1.3) => {
    if (!weights.every(w => w >= 0)) {
        console.warn('normalizeWeights: negative weights detected, using absolute values');
        weights = weights.map(w => m.abs(w));
    }
    const range = max - min + 1;
    let w = weights.map(weight => weight * rf(variationLow, variationHigh));
    if (w.length !== range) {
        if (w.length < range) {
            const newWeights = [];
            for (let i = 0; i < range; i++) {
                const fraction = i / (range - 1);
                const lowerIndex = m.floor(fraction * (w.length - 1));
                const upperIndex = m.min(lowerIndex + 1, w.length - 1);
                const weightDiff = w[upperIndex] - w[lowerIndex];
                const interpolatedWeight = w[lowerIndex] + (fraction * (w.length - 1) - lowerIndex) * weightDiff;
                newWeights.push(interpolatedWeight);
            }
            w = newWeights;
        }
        else {
            const groupSize = m.floor(w.length / range);
            w = Array(range).fill(0).map((_, i) => {
                const startIndex = i * groupSize;
                const endIndex = m.min(startIndex + groupSize, w.length);
                return w.slice(startIndex, endIndex).reduce((sum, ww) => sum + ww, 0) / (endIndex - startIndex);
            });
        }
    }
    const totalWeight = w.reduce((acc, ww) => acc + ww, 0);
    return w.map(ww => ww / totalWeight);
};
exports.normalizeWeights = normalizeWeights;
/**
 * Random weighted selection in inclusive range.
 */
const rw = (min, max, weights) => {
    const normalizedWeights = normalizeWeights(weights, min, max);
    let random = rf();
    for (let i = 0; i < normalizedWeights.length; i++) {
        random -= normalizedWeights[i];
        if (random <= 0)
            return i + min;
    }
    return max;
};
exports.rw = rw;
const randomWeightedInRange = rw;
exports.randomWeightedInRange = randomWeightedInRange;
/**
 * Random weighted selection from array.
 */
const randomWeightedInArray = (weights) => {
    const normalizedWeights = normalizeWeights(weights, 0, weights.length - 1);
    let random = rf();
    for (let i = 0; i < normalizedWeights.length; i++) {
        random -= normalizedWeights[i];
        if (random <= 0)
            return i;
    }
    return weights.length - 1;
};
exports.randomWeightedInArray = randomWeightedInArray;
/**
 * Random weighted selection from options object.
 */
const randomWeightedSelection = (options) => {
    const types = Object.keys(options);
    const weights = types.map(type => options[type].weights?.[0] ?? 1);
    const normalizedWeights = normalizeWeights(weights, 0, types.length - 1);
    const selectedIndex = rw(0, types.length - 1, normalizedWeights);
    return types[selectedIndex];
};
exports.randomWeightedSelection = randomWeightedSelection;
/**
 * Provide params as a function for range, otherwise returns random value from array.
 */
const ra = (v) => {
    if (typeof v === 'function') {
        const result = v();
        if (Array.isArray(result) && result.length === 2 && typeof result[0] === 'number' && typeof result[1] === 'number') {
            return ri(result[0], result[1]);
        }
        return Array.isArray(result) ? ra(result) : result;
    }
    else if (Array.isArray(v)) {
        return v[ri(v.length - 1)];
    }
    return v;
};
exports.ra = ra;
const randomInRangeOrArray = ra;
exports.randomInRangeOrArray = randomInRangeOrArray;
// Timing and counter variables
let measureCount = 0, spMeasure = 0, subsubdivStart = 0, subdivStart = 0, beatStart = 0, divStart = 0, sectionStart = 0, sectionStartTime = 0, tpSubsubdiv = 0, tpSection = 0, spSection = 0, finalTick = 0, bestMatch = 0, polyMeterRatio = 0, polyNumerator = 0, tpSec = 0, finalTime = 0, endTime = 0, phraseStart = 0, tpPhrase1 = 0, tpPhrase2 = 0, phraseStartTime = 0, spPhrase = 0, measuresPerPhrase1 = 0, measuresPerPhrase2 = 0, subdivsPerMinute = 0, subsubdivsPerMinute = 0, numerator = 0, meterRatio = 0, divsPerBeat = 0, subdivsPerBeat = 0, subdivsPerDiv = 0, subdivsPerSub = 0, measureStart = 0, measureStartTime = 0, beatsUntilBinauralShift = 0, beatCount = 0, beatsOn = 0, beatsOff = 0, divsOn = 0, divsOff = 0, subdivsOn = 0, subdivsOff = 0, noteCount = 0, beatRhythm = 0, divRhythm = 0, subdivRhythm = 0, subsubdivRhythm = 0, subsubsPerSub = 0, balOffset = 0, sideBias = 0, firstLoop = 0, lastCrossMod = 0, bpmRatio = 0, sectionIndex = 0, phraseIndex = 0, phrasesPerSection = 0, totalSections = 0;
exports.measureCount = measureCount;
exports.subsubdivStart = subsubdivStart;
exports.subdivStart = subdivStart;
exports.divStart = divStart;
exports.beatCount = beatCount;
exports.noteCount = noteCount;
/**
 * Cross-modulation factor for polyrhythmic interference.
 */
let crossModulation = 2.2;
/**
 * Last used meter configuration.
 */
let lastMeter = [4, 4];
/**
 * Sets tracking used MIDI channels to avoid repetition.
 */
let lastUsedCHs = new Set();
let lastUsedCHs2 = new Set();
let lastUsedCHs3 = new Set();
/**
 * Default MIDI velocity.
 */
let velocity = 99;
/**
 * Toggle for binaural beat channel flip.
 */
let flipBin = false;
/**
 * Neutral pitch bend value (center of pitch bend range).
 */
const neutralPitchBend = 8192;
exports.neutralPitchBend = neutralPitchBend;
/**
 * Semitone value in pitch bend units.
 */
const semitone = neutralPitchBend / 2;
exports.semitone = semitone;
// NOTE: These will be defined when venue.js is loaded
let centsToTuningFreq = 0;
let tuningPitchBend = 0;
let binauralFreqOffset = 0;
let binauralOffset = () => 0;
let binauralPlus = 0;
let binauralMinus = 0;
// MIDI channel constants
const cCH1 = 0, cCH2 = 1, lCH1 = 2, rCH1 = 3, lCH3 = 4, rCH3 = 5, lCH2 = 6, rCH2 = 7, lCH4 = 8, drumCH = 9, rCH4 = 10, cCH3 = 11, lCH5 = 12, rCH5 = 13, lCH6 = 14, rCH6 = 15;
exports.cCH1 = cCH1;
exports.cCH2 = cCH2;
exports.lCH1 = lCH1;
exports.rCH1 = rCH1;
exports.lCH3 = lCH3;
exports.rCH3 = rCH3;
exports.lCH2 = lCH2;
exports.rCH2 = rCH2;
exports.lCH4 = lCH4;
exports.drumCH = drumCH;
exports.rCH4 = rCH4;
exports.cCH3 = cCH3;
exports.lCH5 = lCH5;
exports.rCH5 = rCH5;
exports.lCH6 = lCH6;
exports.rCH6 = rCH6;
const bass = [cCH3, lCH5, rCH5, lCH6, rCH6];
exports.bass = bass;
const bassBinaural = [lCH5, rCH5, lCH6, rCH6];
exports.bassBinaural = bassBinaural;
const source = [cCH1, lCH1, lCH2, rCH1, rCH2];
exports.source = source;
const source2 = [cCH1, lCH1, lCH2, rCH1, rCH2, drumCH];
exports.source2 = source2;
const reflection = [cCH2, lCH3, lCH4, rCH3, rCH4];
exports.reflection = reflection;
const reflectionBinaural = [lCH3, lCH4, rCH3, rCH4];
exports.reflectionBinaural = reflectionBinaural;
const reflect = {
    [cCH1]: cCH2, [lCH1]: lCH3, [rCH1]: rCH3, [lCH2]: lCH4, [rCH2]: rCH4
};
exports.reflect = reflect;
const reflect2 = {
    [cCH1]: cCH3, [lCH1]: lCH5, [rCH1]: rCH5, [lCH2]: lCH6, [rCH2]: rCH6
};
exports.reflect2 = reflect2;
const binauralL = [lCH1, lCH2, lCH3, lCH4, lCH5, lCH6];
exports.binauralL = binauralL;
const binauralR = [rCH1, rCH2, rCH3, rCH4, rCH5, rCH6];
exports.binauralR = binauralR;
const flipBinF = [cCH1, cCH2, cCH3, lCH1, rCH1, lCH3, rCH3, lCH5, rCH5];
exports.flipBinF = flipBinF;
const flipBinT = [cCH1, cCH2, cCH3, lCH2, rCH2, lCH4, rCH4, lCH6, rCH6];
exports.flipBinT = flipBinT;
const flipBinF2 = [lCH1, rCH1, lCH3, rCH3, lCH5, rCH5];
exports.flipBinF2 = flipBinF2;
const flipBinT2 = [lCH2, rCH2, lCH4, rCH4, lCH6, rCH6];
exports.flipBinT2 = flipBinT2;
const flipBinF3 = [cCH2, cCH3, lCH1, rCH1, lCH3, rCH3, lCH5, rCH5];
exports.flipBinF3 = flipBinF3;
const flipBinT3 = [cCH2, cCH3, lCH2, rCH2, lCH4, rCH4, lCH6, rCH6];
exports.flipBinT3 = flipBinT3;
const stutterFadeCHs = [cCH2, cCH3, lCH1, rCH1, lCH2, rCH2, lCH3, rCH3, lCH4, rCH4, lCH5, rCH5, lCH6, rCH6];
exports.stutterFadeCHs = stutterFadeCHs;
const allCHs = [cCH1, cCH2, cCH3, lCH1, rCH1, lCH2, rCH2, lCH3, rCH3, lCH4, rCH4, lCH5, rCH5, lCH6, rCH6, drumCH];
exports.allCHs = allCHs;
const stutterPanCHs = [cCH1, cCH2, cCH3, drumCH];
exports.stutterPanCHs = stutterPanCHs;
const FX = [1, 5, 11, 65, 67, 68, 69, 70, 71, 72, 73, 74, 91, 92, 93, 94, 95];
exports.FX = FX;
/**
 * Send All Notes Off CC (123) to prevent sustain across transitions.
 */
const allNotesOff = (tick = measureStart) => {
    return allCHs.map(ch => ({ tick: m.max(0, tick - 1), type: 'control_c', vals: [ch, 123, 0] }));
};
exports.allNotesOff = allNotesOff;
/**
 * Send Mute All CC (120) to silence all channels.
 */
const muteAll = (tick = measureStart) => {
    return allCHs.map(ch => ({ tick: m.max(0, tick - 1), type: 'control_c', vals: [ch, 120, 0] }));
};
exports.muteAll = muteAll;
globalThis.m = m;
globalThis.clamp = clamp;
globalThis.modClamp = modClamp;
globalThis.rf = rf;
globalThis.ri = ri;
globalThis.rw = rw;
globalThis.rv = rv;
globalThis.rl = rl;
globalThis.ra = ra;
//# sourceMappingURL=backstage.js.map
