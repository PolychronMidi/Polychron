// backstage.ts - Core utilities, randomization, and MIDI infrastructure.
// minimalist comments, details at: backstage.md

const m = Math;

/**
 * Clamp a value within [min, max] range.
 * @param value - Value to clamp.
 * @param min - Minimum allowed value.
 * @param max - Maximum allowed value.
 * @returns Clamped value.
 */
const clamp = (value: number, min: number, max: number): number => {
  if (min > max) [min, max] = [max, min];
  return m.min(m.max(value, min), max);
};

/**
 * Modulo-based clamp: Value wraps around within range.
 */
const modClamp = (value: number, min: number, max: number): number => {
  if (min > max) [min, max] = [max, min];
  const range = max - min + 1;
  if (range <= 0) return min;
  return ((value - min) % range + range) % range + min;
};

/**
 * Regular clamp at high end, modClamp at low end.
 */
const lowModClamp = (value: number, min: number, max: number): number => {
  if (value >= max) return max;
  else if (value < min) return modClamp(value, min, max);
  else return value;
};

/**
 * Regular clamp at low end, modClamp at high end.
 */
const highModClamp = (value: number, min: number, max: number): number => {
  if (value <= min) return min;
  else if (value > max) return modClamp(value, min, max);
  else return value;
};

/**
 * Scale-based clamp with dynamic bounds.
 */
const scaleClamp = (value: number, min: number, max: number, factor: number, maxFactor: number = factor, base: number = value): number => {
  const scaledMin = m.max(min * factor, min);
  const scaledMax = m.min(max * maxFactor, max);
  const lowerBound = m.max(min, m.floor(base * factor));
  const upperBound = m.min(max, m.ceil(base * maxFactor));
  return clamp(value, lowerBound, upperBound);
};

/**
 * Scale-based clamp with explicit bounds.
 */
const scaleBoundClamp = (value: number, base: number, lowerScale: number, upperScale: number, minBound: number = 2, maxBound: number = 9): number => {
  let lowerBound = m.max(minBound, m.floor(base * lowerScale));
  let upperBound = m.min(maxBound, m.ceil(base * upperScale));
  if (lowerBound > upperBound) lowerBound = upperBound;
  return clamp(value, lowerBound, upperBound);
};

/**
 * Soft clamp with gradual boundary approach.
 */
const softClamp = (value: number, min: number, max: number, softness: number = 0.1): number => {
  if (value < min) return min + (value - min) * softness;
  if (value > max) return max - (value - max) * softness;
  return value;
};

/**
 * Step-based clamp: Snaps value to nearest step.
 */
const stepClamp = (value: number, min: number, max: number, step: number): number => {
  const clampedValue = clamp(m.round(value / step) * step, min, max);
  return clampedValue;
};

/**
 * Logarithmic clamp for exponential value ranges.
 */
const logClamp = (value: number, min: number, max: number, base: number = 10): number => {
  const logMin = m.log(min) / m.log(base);
  const logMax = m.log(max) / m.log(base);
  const logValue = m.log(m.max(value, min)) / m.log(base);
  return m.pow(base, m.min(m.max(logValue, logMin), logMax));
};

/**
 * Exponential clamp for logarithmic value ranges.
 */
const expClamp = (value: number, min: number, max: number, base: number = m.E): number => {
  const minExp = m.pow(base, min);
  const maxExp = m.pow(base, max);
  const valueExp = m.pow(base, value);
  return m.log(m.min(m.max(valueExp, minExp), maxExp)) / m.log(base);
};

/**
 * Random Float (decimal) inclusive of min(s) & max(s).
 */
const rf = (min1: number = 1, max1?: number, min2?: number, max2?: number): number => {
  if (max1 === undefined) { max1 = min1; min1 = 0; }
  [min1, max1] = [m.min(min1, max1), m.max(min1, max1)];
  if (min2 !== undefined && max2 !== undefined) {
    [min2, max2] = [m.min(min2, max2), m.max(min2, max2)];
    const range1 = max1 - min1;
    const range2 = max2 - min2;
    const totalRange = range1 + range2;
    const rand = m.random() * totalRange;
    if (rand < range1) return m.random() * (range1 + Number.EPSILON) + min1;
    else return m.random() * (range2 + Number.EPSILON) + min2;
  } else return m.random() * (max1 - min1 + Number.EPSILON) + min1;
};

const randomFloat = rf;

/**
 * Random Integer (whole number) inclusive of min(s) & max(s).
 */
const ri = (min1: number = 1, max1?: number, min2?: number, max2?: number): number => {
  if (max1 === undefined) { max1 = min1; min1 = 0; }
  [min1, max1] = [m.min(min1, max1), m.max(min1, max1)];
  if (min2 !== undefined && max2 !== undefined) {
    [min2, max2] = [m.min(min2, max2), m.max(min2, max2)];
    const range1 = max1 - min1;
    const range2 = max2 - min2;
    const totalRange = range1 + range2;
    const rand = rf() * totalRange;
    if (rand < range1) return clamp(m.round(rf() * range1 + min1), m.ceil(min1), m.floor(max1));
    else return clamp(m.round(rand - range1 + min2), m.ceil(min2), m.floor(max2));
  } else return clamp(m.round(rf() * (max1 - min1) + min1), m.ceil(min1), m.floor(max1));
};

const randomInt = ri;

/**
 * Random Limited Change: Random value from inclusive range, with limited change per iteration.
 */
const rl = (currentValue: number, minChange: number, maxChange: number, minValue: number, maxValue: number, type: string = 'i'): number => {
  const adjustedMinChange = m.min(minChange, maxChange);
  const adjustedMaxChange = m.max(minChange, maxChange);
  const newMin = m.max(minValue, currentValue + adjustedMinChange);
  const newMax = m.min(maxValue, currentValue + adjustedMaxChange);
  return type === 'f' ? rf(newMin, newMax) : ri(newMin, newMax);
};

const randomLimitedChange = rl;

/**
 * Random variation within range(s) at frequency.
 */
const rv = (value: number, boostRange: number[] = [.05, .10], frequency: number = .05, deboostRange: number[] = boostRange): number => {
  let factor: number;
  const singleRange = Array.isArray(deboostRange) ? deboostRange : boostRange;
  const isSingleRange = singleRange.length === 2 && typeof singleRange[0] === 'number' && typeof singleRange[1] === 'number';
  if (isSingleRange) {
    const variation = rf(...singleRange);
    factor = rf() < frequency ? 1 + variation : 1;
  } else {
    const range = rf() < .5 ? boostRange : deboostRange;
    factor = rf() < frequency ? 1 + rf(...range) : 1;
  }
  return value * factor;
};

const randomVariation = rv;

/**
 * Normalize Weights: Any sized list of weights with any values are normalized to fit inclusive range.
 */
const normalizeWeights = (weights: number[], min: number, max: number, variationLow: number = .7, variationHigh: number = 1.3): number[] => {
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
    } else {
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

/**
 * Random weighted selection in inclusive range.
 */
const rw = (min: number, max: number, weights: number[]): number => {
  const normalizedWeights = normalizeWeights(weights, min, max);
  let random = rf();
  for (let i = 0; i < normalizedWeights.length; i++) {
    random -= normalizedWeights[i];
    if (random <= 0) return i + min;
  }
  return max;
};

const randomWeightedInRange = rw;

/**
 * Random weighted selection from array.
 */
const randomWeightedInArray = (weights: number[]): number => {
  const normalizedWeights = normalizeWeights(weights, 0, weights.length - 1);
  let random = rf();
  for (let i = 0; i < normalizedWeights.length; i++) {
    random -= normalizedWeights[i];
    if (random <= 0) return i;
  }
  return weights.length - 1;
};

/**
 * Random weighted selection from options object.
 */
const randomWeightedSelection = (options: any): string => {
  const types = Object.keys(options);
  const weights = types.map(type => options[type].weights?.[0] ?? 1);
  const normalizedWeights = normalizeWeights(weights, 0, types.length - 1);
  const selectedIndex = rw(0, types.length - 1, normalizedWeights);
  return types[selectedIndex];
};

/**
 * Provide params as a function for range, otherwise returns random value from array.
 */
const ra = (v: any): any => {
  if (typeof v === 'function') {
    const result = v();
    if (Array.isArray(result) && result.length === 2 && typeof result[0] === 'number' && typeof result[1] === 'number') {
      return ri(result[0], result[1]);
    }
    return Array.isArray(result) ? ra(result) : result;
  } else if (Array.isArray(v)) {
    return v[ri(v.length - 1)];
  }
  return v;
};

const randomInRangeOrArray = ra;

// Timing and counter variables
let measureCount = 0, spMeasure = 0, subsubdivStart = 0, subdivStart = 0, beatStart = 0, divStart = 0, sectionStart = 0, sectionStartTime = 0, tpSubsubdiv = 0, tpSection = 0, spSection = 0, finalTick = 0, bestMatch = 0, polyMeterRatio = 0, polyNumerator = 0, tpSec = 0, finalTime = 0, endTime = 0, phraseStart = 0, tpPhrase1 = 0, tpPhrase2 = 0, phraseStartTime = 0, spPhrase = 0, measuresPerPhrase1 = 0, measuresPerPhrase2 = 0, subdivsPerMinute = 0, subsubdivsPerMinute = 0, numerator = 0, meterRatio = 0, divsPerBeat = 0, subdivsPerBeat = 0, subdivsPerDiv = 0, subdivsPerSub = 0, measureStart = 0, measureStartTime = 0, beatsUntilBinauralShift = 0, beatCount = 0, beatsOn = 0, beatsOff = 0, divsOn = 0, divsOff = 0, subdivsOn = 0, subdivsOff = 0, noteCount = 0, beatRhythm = 0, divRhythm = 0, subdivRhythm = 0, subsubdivRhythm = 0, subsubsPerSub = 0, balOffset = 0, sideBias = 0, firstLoop = 0, lastCrossMod = 0, bpmRatio = 1, bpmRatio2 = 1, bpmRatio3 = 1, sectionIndex = 0, phraseIndex = 0, phrasesPerSection = 0, totalSections = 0;

/**
 * Cross-modulation factor for polyrhythmic interference.
 */
let crossModulation = 2.2;

/**
 * Last used meter configuration.
 */
let lastMeter: number[] = [4, 4];

/**
 * Sets tracking used MIDI channels to avoid repetition.
 */
let lastUsedCHs = new Set<number>();
let lastUsedCHs2 = new Set<number>();
let lastUsedCHs3 = new Set<number>();

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

/**
 * Semitone value in pitch bend units.
 */
const semitone = neutralPitchBend / 2;

// NOTE: These will be defined when venue.js is loaded
let centsToTuningFreq = 0;
let tuningPitchBend = 0;
let binauralFreqOffset = 0;
let binauralOffset: (plusOrMinus: number) => number = () => 0;
let binauralPlus = 0;
let binauralMinus = 0;

// MIDI channel constants
const cCH1 = 0, cCH2 = 1, lCH1 = 2, rCH1 = 3, lCH3 = 4, rCH3 = 5, lCH2 = 6, rCH2 = 7, lCH4 = 8, drumCH = 9, rCH4 = 10, cCH3 = 11, lCH5 = 12, rCH5 = 13, lCH6 = 14, rCH6 = 15;

const bass = [cCH3, lCH5, rCH5, lCH6, rCH6];
const bassBinaural = [lCH5, rCH5, lCH6, rCH6];
const source = [cCH1, lCH1, lCH2, rCH1, rCH2];
const source2 = [cCH1, lCH1, lCH2, rCH1, rCH2, drumCH];
const reflection = [cCH2, lCH3, lCH4, rCH3, rCH4];
const reflectionBinaural = [lCH3, lCH4, rCH3, rCH4];

const reflect: { [key: number]: number } = {
  [cCH1]: cCH2, [lCH1]: lCH3, [rCH1]: rCH3, [lCH2]: lCH4, [rCH2]: rCH4
};

const reflect2: { [key: number]: number } = {
  [cCH1]: cCH3, [lCH1]: lCH5, [rCH1]: rCH5, [lCH2]: lCH6, [rCH2]: rCH6
};

const binauralL = [lCH1, lCH2, lCH3, lCH4, lCH5, lCH6];
const binauralR = [rCH1, rCH2, rCH3, rCH4, rCH5, rCH6];

const flipBinF = [cCH1, cCH2, cCH3, lCH1, rCH1, lCH3, rCH3, lCH5, rCH5];
const flipBinT = [cCH1, cCH2, cCH3, lCH2, rCH2, lCH4, rCH4, lCH6, rCH6];
const flipBinF2 = [lCH1, rCH1, lCH3, rCH3, lCH5, rCH5];
const flipBinT2 = [lCH2, rCH2, lCH4, rCH4, lCH6, rCH6];
const flipBinF3 = [cCH2, cCH3, lCH1, rCH1, lCH3, rCH3, lCH5, rCH5];
const flipBinT3 = [cCH2, cCH3, lCH2, rCH2, lCH4, rCH4, lCH6, rCH6];

const stutterFadeCHs = [cCH2, cCH3, lCH1, rCH1, lCH2, rCH2, lCH3, rCH3, lCH4, rCH4, lCH5, rCH5, lCH6, rCH6];
const allCHs = [cCH1, cCH2, cCH3, lCH1, rCH1, lCH2, rCH2, lCH3, rCH3, lCH4, rCH4, lCH5, rCH5, lCH6, rCH6, drumCH];
const stutterPanCHs = [cCH1, cCH2, cCH3, drumCH];

const FX = [1, 5, 11, 65, 67, 68, 69, 70, 71, 72, 73, 74, 91, 92, 93, 94, 95];

/**
 * Send All Notes Off CC (123) to prevent sustain across transitions.
 */
const allNotesOff = (tick: number = measureStart): any[] => {
  const events = allCHs.map(ch => ({ tick: m.max(0, tick - 1), type: 'control_c', vals: [ch, 123, 0] }));
  if ((globalThis as any).c) {
    if (Array.isArray((globalThis as any).c)) {
      (globalThis as any).c.push(...events);
    } else if ((globalThis as any).c.push) {
      (globalThis as any).c.push(...events);
    }
  }
  return events;
};

/**
 * Send Mute All CC (120) to silence all channels.
 */
const muteAll = (tick: number = measureStart): any[] => {
  const events = allCHs.map(ch => ({ tick: m.max(0, tick - 1), type: 'control_c', vals: [ch, 120, 0] }));
  if ((globalThis as any).c) {
    if (Array.isArray((globalThis as any).c)) {
      (globalThis as any).c.push(...events);
    } else if ((globalThis as any).c.push) {
      (globalThis as any).c.push(...events);
    }
  }
  return events;
};
/**
 * Helper to create randomized FX control change messages
 * Signature: (channel, ccNum, minVal, maxVal, [condition], [condMinVal], [condMaxVal])
 */
const rlFX = (ch: number, cc: number, min: number, max: number, condition?: (c: number) => boolean, condMin?: number, condMax?: number): any => {
  const useCondition = condition && condition(ch);
  const actualMin = useCondition && condMin !== undefined ? condMin : min;
  const actualMax = useCondition && condMax !== undefined ? condMax : max;
  const beatStartValue = (globalThis as any).beatStart !== undefined ? (globalThis as any).beatStart : beatStart;
  return { tick: beatStartValue - 1, type: 'control_c', vals: [ch, cc, ri(actualMin, actualMax)] };
};;
// Export for global use
export {
  clamp, modClamp, lowModClamp, highModClamp, scaleClamp, scaleBoundClamp, softClamp, stepClamp, logClamp, expClamp,
  rf, randomFloat, ri, randomInt, rl, randomLimitedChange, rv, randomVariation, rw, randomWeightedInRange, ra, randomInRangeOrArray,
  normalizeWeights, randomWeightedInArray, randomWeightedSelection,
  cCH1, cCH2, cCH3, lCH1, rCH1, lCH2, rCH2, lCH3, rCH3, lCH4, rCH4, lCH5, rCH5, lCH6, rCH6, drumCH,
  bass, bassBinaural, source, source2, reflection, reflectionBinaural, reflect, reflect2,
  binauralL, binauralR, flipBinF, flipBinT, flipBinF2, flipBinT2, flipBinF3, flipBinT3,
  stutterFadeCHs, allCHs, stutterPanCHs, FX, allNotesOff, muteAll,
  neutralPitchBend, semitone,
  // Timing variables
  measureCount, beatCount, noteCount, divStart, subdivStart, subsubdivStart,
  // Export setter functions would go here for mutable timing state
  m
};

// Make globally available (matches original behavior)
declare global {
  var m: any;
  var clamp: any;
  var modClamp: any;
  var lowModClamp: any;
  var highModClamp: any;
  var scaleClamp: any;
  var scaleBoundClamp: any;
  var softClamp: any;
  var stepClamp: any;
  var logClamp: any;
  var expClamp: any;
  var rf: any;
  var randomFloat: any;
  var ri: any;
  var randomInt: any;
  var rl: any;
  var randomLimitedChange: any;
  var rv: any;
  var randomVariation: any;
  var rw: any;
  var randomWeightedInRange: any;
  var ra: any;
  var randomInRangeOrArray: any;
  var normalizeWeights: any;
  var randomWeightedInArray: any;
  var randomWeightedSelection: any;
  var measureCount: number;
  var beatCount: number;
  var divStart: number;
  var subdivStart: number;
  // MIDI channel globals
  var cCH1: number;
  var cCH2: number;
  var cCH3: number;
  var lCH1: number;
  var rCH1: number;
  var lCH2: number;
  var rCH2: number;
  var lCH3: number;
  var rCH3: number;
  var lCH4: number;
  var rCH4: number;
  var lCH5: number;
  var rCH5: number;
  var lCH6: number;
  var rCH6: number;
  var drumCH: number;
  var bass: number[];
  var source: number[];
  var allCHs: number[];
  var binauralL: number[];
  var binauralR: number[];
}

(globalThis as any).m = m;
(globalThis as any).clamp = clamp;
(globalThis as any).modClamp = modClamp;
(globalThis as any).lowModClamp = lowModClamp;
(globalThis as any).highModClamp = highModClamp;
(globalThis as any).scaleClamp = scaleClamp;
(globalThis as any).scaleBoundClamp = scaleBoundClamp;
(globalThis as any).softClamp = softClamp;
(globalThis as any).stepClamp = stepClamp;
(globalThis as any).logClamp = logClamp;
(globalThis as any).expClamp = expClamp;
(globalThis as any).rf = rf;
(globalThis as any).randomFloat = randomFloat;
(globalThis as any).ri = ri;
(globalThis as any).randomInt = randomInt;
(globalThis as any).rl = rl;
(globalThis as any).randomLimitedChange = randomLimitedChange;
(globalThis as any).rv = rv;
(globalThis as any).randomVariation = randomVariation;
(globalThis as any).rw = rw;
(globalThis as any).randomWeightedInRange = randomWeightedInRange;
(globalThis as any).ra = ra;
(globalThis as any).randomInRangeOrArray = randomInRangeOrArray;
(globalThis as any).normalizeWeights = normalizeWeights;
(globalThis as any).randomWeightedInArray = randomWeightedInArray;
(globalThis as any).randomWeightedSelection = randomWeightedSelection;
(globalThis as any).cCH1 = cCH1;
(globalThis as any).cCH2 = cCH2;
(globalThis as any).cCH3 = cCH3;
(globalThis as any).lCH1 = lCH1;
(globalThis as any).rCH1 = rCH1;
(globalThis as any).lCH2 = lCH2;
(globalThis as any).rCH2 = rCH2;
(globalThis as any).lCH3 = lCH3;
(globalThis as any).rCH3 = rCH3;
(globalThis as any).lCH4 = lCH4;
(globalThis as any).rCH4 = rCH4;
(globalThis as any).lCH5 = lCH5;
(globalThis as any).rCH5 = rCH5;
(globalThis as any).lCH6 = lCH6;
(globalThis as any).rCH6 = rCH6;
(globalThis as any).drumCH = drumCH;
(globalThis as any).bass = bass;
(globalThis as any).source = source;
(globalThis as any).allCHs = allCHs;
(globalThis as any).binauralL = binauralL;
(globalThis as any).binauralR = binauralR;
(globalThis as any).reflectionBinaural = reflectionBinaural;
(globalThis as any).bass = bass;
(globalThis as any).bassBinaural = bassBinaural;
(globalThis as any).source = source;
(globalThis as any).source2 = source2;
(globalThis as any).reflection = reflection;
(globalThis as any).reflect = reflect;
(globalThis as any).reflect2 = reflect2;
(globalThis as any).flipBinF = flipBinF;
(globalThis as any).flipBinT = flipBinT;
(globalThis as any).flipBinF2 = flipBinF2;
(globalThis as any).flipBinT2 = flipBinT2;
(globalThis as any).flipBinF3 = flipBinF3;
(globalThis as any).flipBinT3 = flipBinT3;
(globalThis as any).stutterFadeCHs = stutterFadeCHs;
(globalThis as any).allCHs = allCHs;
(globalThis as any).stutterPanCHs = stutterPanCHs;
(globalThis as any).FX = FX;

// Export critical timing variables needed by composers
(globalThis as any).bpmRatio = bpmRatio;
(globalThis as any).bpmRatio2 = bpmRatio2;
(globalThis as any).bpmRatio3 = bpmRatio3;
(globalThis as any).measureCount = measureCount;
(globalThis as any).numerator = numerator;
(globalThis as any).beatCount = beatCount;
(globalThis as any).beatsUntilBinauralShift = beatsUntilBinauralShift;
(globalThis as any).flipBin = flipBin;
(globalThis as any).binauralFreqOffset = binauralFreqOffset;
(globalThis as any).binauralPlus = binauralPlus;
(globalThis as any).binauralMinus = binauralMinus;
(globalThis as any).cCH1 = cCH1;
(globalThis as any).cCH2 = cCH2;
(globalThis as any).cCH3 = cCH3;
(globalThis as any).lCH1 = lCH1;
(globalThis as any).lCH2 = lCH2;
(globalThis as any).lCH3 = lCH3;
(globalThis as any).lCH4 = lCH4;
(globalThis as any).lCH5 = lCH5;
(globalThis as any).lCH6 = lCH6;
(globalThis as any).rCH1 = rCH1;
(globalThis as any).rCH2 = rCH2;
(globalThis as any).rCH3 = rCH3;
(globalThis as any).rCH4 = rCH4;
(globalThis as any).rCH5 = rCH5;
(globalThis as any).rCH6 = rCH6;
(globalThis as any).drumCH = drumCH;
(globalThis as any).allNotesOff = allNotesOff;
(globalThis as any).muteAll = muteAll;
(globalThis as any).rlFX = rlFX;
(globalThis as any).tpSec = tpSec;
(globalThis as any).tpSubsubdiv = tpSubsubdiv;
(globalThis as any).measureStart = measureStart;
(globalThis as any).beatStart = beatStart;
(globalThis as any).divStart = divStart;
(globalThis as any).subdivStart = subdivStart;
(globalThis as any).subsubdivStart = subsubdivStart;
(globalThis as any).subdivsPerDiv = subdivsPerDiv;
(globalThis as any).subdivsPerBeat = subdivsPerBeat;
(globalThis as any).subsubsPerSub = subsubsPerSub;
(globalThis as any).divsPerBeat = divsPerBeat;
(globalThis as any).tuningPitchBend = tuningPitchBend;
(globalThis as any).velocity = velocity;
(globalThis as any).beatRhythm = beatRhythm;
(globalThis as any).divRhythm = divRhythm;
(globalThis as any).subdivRhythm = subdivRhythm;
(globalThis as any).subsubdivRhythm = subsubdivRhythm;
(globalThis as any).beatsOn = beatsOn;
(globalThis as any).beatsOff = beatsOff;
(globalThis as any).divsOn = divsOn;
(globalThis as any).divsOff = divsOff;
(globalThis as any).subdivsOn = subdivsOn;
(globalThis as any).subdivsOff = subdivsOff;
(globalThis as any).binauralL = binauralL;
(globalThis as any).binauralR = binauralR;
