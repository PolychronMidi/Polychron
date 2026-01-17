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
  if (g.c) {
    if (Array.isArray(g.c)) {
      g.c.push(...events);
    } else if (g.c.push) {
      g.c.push(...events);
    }
  }
  return events;
};

/**
 * Send Mute All CC (120) to silence all channels.
 */
const muteAll = (tick: number = measureStart): any[] => {
  const events = allCHs.map(ch => ({ tick: m.max(0, tick - 1), type: 'control_c', vals: [ch, 120, 0] }));
  if (g.c) {
    if (Array.isArray(g.c)) {
      g.c.push(...events);
    } else if (g.c.push) {
      g.c.push(...events);
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
  const beatStartValue = g.beatStart !== undefined ? g.beatStart : beatStart;
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

// Shorthand alias for global registrations
const g = globalThis as any;

g.m = m;
g.clamp = clamp;
g.modClamp = modClamp;
g.lowModClamp = lowModClamp;
g.highModClamp = highModClamp;
g.scaleClamp = scaleClamp;
g.scaleBoundClamp = scaleBoundClamp;
g.softClamp = softClamp;
g.stepClamp = stepClamp;
g.logClamp = logClamp;
g.expClamp = expClamp;
g.rf = rf;
g.randomFloat = randomFloat;
g.ri = ri;
g.randomInt = randomInt;
g.rl = rl;
g.randomLimitedChange = randomLimitedChange;
g.rv = rv;
g.randomVariation = randomVariation;
g.rw = rw;
g.randomWeightedInRange = randomWeightedInRange;
g.ra = ra;
g.randomInRangeOrArray = randomInRangeOrArray;
g.normalizeWeights = normalizeWeights;
g.randomWeightedInArray = randomWeightedInArray;
g.randomWeightedSelection = randomWeightedSelection;
g.cCH1 = cCH1;
g.cCH2 = cCH2;
g.cCH3 = cCH3;
g.lCH1 = lCH1;
g.rCH1 = rCH1;
g.lCH2 = lCH2;
g.rCH2 = rCH2;
g.lCH3 = lCH3;
g.rCH3 = rCH3;
g.lCH4 = lCH4;
g.rCH4 = rCH4;
g.lCH5 = lCH5;
g.rCH5 = rCH5;
g.lCH6 = lCH6;
g.rCH6 = rCH6;
g.drumCH = drumCH;
g.bass = bass;
g.source = source;
g.allCHs = allCHs;
g.binauralL = binauralL;
g.binauralR = binauralR;
g.reflectionBinaural = reflectionBinaural;
g.bassBinaural = bassBinaural;
g.source2 = source2;
g.reflection = reflection;
g.reflect = reflect;
g.reflect2 = reflect2;
g.flipBinF = flipBinF;
g.flipBinT = flipBinT;
g.flipBinF2 = flipBinF2;
g.flipBinT2 = flipBinT2;
g.flipBinF3 = flipBinF3;
g.flipBinT3 = flipBinT3;
g.stutterFadeCHs = stutterFadeCHs;
g.stutterPanCHs = stutterPanCHs;
g.FX = FX;

// Export critical timing variables needed by composers
g.bpmRatio = bpmRatio;
g.bpmRatio2 = bpmRatio2;
g.bpmRatio3 = bpmRatio3;
g.measureCount = measureCount;
g.numerator = numerator;
g.beatCount = beatCount;
g.beatsUntilBinauralShift = beatsUntilBinauralShift;
g.flipBin = flipBin;
g.binauralFreqOffset = binauralFreqOffset;
g.binauralPlus = binauralPlus;
g.binauralMinus = binauralMinus;
g.cCH1 = cCH1;
g.cCH2 = cCH2;
g.cCH3 = cCH3;
g.lCH1 = lCH1;
g.lCH2 = lCH2;
g.lCH3 = lCH3;
g.lCH4 = lCH4;
g.lCH5 = lCH5;
g.lCH6 = lCH6;
g.rCH1 = rCH1;
g.rCH2 = rCH2;
g.rCH3 = rCH3;
g.rCH4 = rCH4;
g.rCH5 = rCH5;
g.rCH6 = rCH6;
g.allNotesOff = allNotesOff;
g.muteAll = muteAll;
g.rlFX = rlFX;
g.tpSec = tpSec;
g.tpSubsubdiv = tpSubsubdiv;
g.measureStart = measureStart;
g.beatStart = beatStart;
g.divStart = divStart;
g.subdivStart = subdivStart;
g.subsubdivStart = subsubdivStart;
g.subdivsPerDiv = subdivsPerDiv;
g.subdivsPerBeat = subdivsPerBeat;
g.subsubsPerSub = subsubsPerSub;
g.divsPerBeat = divsPerBeat;
g.tuningPitchBend = tuningPitchBend;
g.velocity = velocity;
g.beatRhythm = beatRhythm;
g.divRhythm = divRhythm;
g.subdivRhythm = subdivRhythm;
g.subsubdivRhythm = subsubdivRhythm;
g.beatsOn = beatsOn;
g.beatsOff = beatsOff;
g.divsOn = divsOn;
g.divsOff = divsOff;
g.subdivsOn = subdivsOn;
g.subdivsOff = subdivsOff;
