// backstage.ts - Core utilities, randomization, and MIDI infrastructure.
// minimalist comments, details at: backstage.md
// Utilities re-exported from utils.ts
export {
  clamp, modClamp, lowModClamp, highModClamp, scaleClamp, scaleBoundClamp, softClamp, stepClamp, logClamp, expClamp,
  rf, randomFloat, ri, randomInt, rl, randomLimitedChange, rv, randomVariation, rw, randomWeightedInRange, ra, randomInRangeOrArray,
  normalizeWeights, randomWeightedInArray, randomWeightedSelection,
  default as m,
} from './utils.js';

import * as Utils from './utils.js';
import {
  clamp, modClamp, lowModClamp, highModClamp, scaleClamp, scaleBoundClamp, softClamp, stepClamp, logClamp, expClamp,
  rf, randomFloat, ri, randomInt, rl, randomLimitedChange, rv, randomVariation, rw, randomWeightedInRange, ra, randomInRangeOrArray,
  normalizeWeights, randomWeightedInArray, randomWeightedSelection,
} from './utils.js';

const m = Utils.default;


// Timing and counter variables
let measureCount = 0, spMeasure = 0, subsubdivStart = 0, subdivStart = 0, beatStart = 0, divStart = 0, sectionStart = 0, sectionStartTime = 0, tpSubsubdiv = 0, tpSection = 0, spSection = 0, finalTick = 0, bestMatch = 0, polyMeterRatio = 0, polyNumerator = 0, tpSec = 0, finalTime = 0, endTime = 0, phraseStart = 0, tpPhrase1 = 0, tpPhrase2 = 0, phraseStartTime = 0, spPhrase = 0, measuresPerPhrase1 = 0, measuresPerPhrase2 = 0, subdivsPerMinute = 0, subsubdivsPerMinute = 0, numerator = 0, meterRatio = 0, divsPerBeat = 0, subdivsPerBeat = 0, subdivsPerDiv = 0, subdivsPerSub = 0, measureStart = 0, measureStartTime = 0, beatsUntilBinauralShift = 0, beatCount = 0, beatsOn = 0, beatsOff = 0, divsOn = 0, divsOff = 0, subdivsOn = 0, subdivsOff = 0, noteCount = 0, beatRhythm = 0, divRhythm = 0, subdivRhythm = 0, subsubdivRhythm = 0, subsubdivsPerSub = 0, balOffset = 0, sideBias = 0, firstLoop = 0, lastCrossMod = 0, bpmRatio = 1, bpmRatio2 = 1, bpmRatio3 = 1, sectionIndex = 0, phraseIndex = 0, phrasesPerSection = 0, totalSections = 0;

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
export let tuningPitchBend = 0;
let binauralFreqOffset = 0;
let binauralOffset: (plusOrMinus: number) => number = () => 0;
export let binauralPlus = 0;
export let binauralMinus = 0;

// Test helper: returns whether test logging is enabled (uses legacy test namespace)
export function isTestLoggingEnabled(): boolean {
  return (globalThis as any).__POLYCHRON_TEST__?.enableLogging ?? false;
}

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
 * Send All Notes Off CC (123) to prevent sustain across section changes.
 */
export const allNotesOff = (tick: number = measureStart): any[] => {
  const events = allCHs.map(ch => ({ tick: m.max(0, tick - 1), type: 'control_c', vals: [ch, 123, 0] }));
  // For legacy tests that still use the writer CSV buffer helper in globalThis, push to g.c if present
  const maybeC = (globalThis as any).c;
  if (maybeC) {
    if (Array.isArray(maybeC)) {
      maybeC.push(...events);
    } else if ((maybeC as any).push) {
      (maybeC as any).push(...events);
    }
  }
  return events;
};

/**
 * Send Mute All CC (120) to silence all channels.
 */
export const muteAll = (tick: number = measureStart): any[] => {
  const events = allCHs.map(ch => ({ tick: m.max(0, tick - 1), type: 'control_c', vals: [ch, 120, 0] }));
  const maybeC = (globalThis as any).c;
  if (maybeC) {
    if (Array.isArray(maybeC)) {
      maybeC.push(...events);
    } else if ((maybeC as any).push) {
      (maybeC as any).push(...events);
    }
  }
  return events;
};
/**
 * Helper to create randomized FX control change messages
 * Signature: (channel, ccNum, minVal, maxVal, [condition], [condMinVal], [condMaxVal])
 */
export const rlFX = (ch: number, cc: number, min: number, max: number, condition?: (c: number) => boolean, condMin?: number, condMax?: number): any => {
  const useCondition = condition && condition(ch);
  const actualMin = useCondition && condMin !== undefined ? condMin : min;
  const actualMax = useCondition && condMax !== undefined ? condMax : max;
  const beatStartValue = ((globalThis as any).beatStart !== undefined) ? (globalThis as any).beatStart : beatStart;
  return { tick: beatStartValue - 1, type: 'control_c', vals: [ch, cc, ri(actualMin, actualMax)] };
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

// Export channel constants and helpers as named exports for DI and imports
export {
  cCH1, cCH2, cCH3, lCH1, rCH1, lCH2, rCH2, lCH3, rCH3, lCH4, rCH4, lCH5, rCH5, lCH6, rCH6, drumCH,
  bass, bassBinaural, source, source2, reflection, reflectionBinaural, reflect, reflect2,
  binauralL, binauralR, flipBinF, flipBinT, flipBinF2, flipBinT2, flipBinF3, stutterFadeCHs, allCHs, stutterPanCHs, FX
};

// No legacy features should be used anywhere: use DI only
// export function attachLegacyGlobals(target?: any): void {
//   const g = target ?? (globalThis as any);

//   g.flipBinT3 = flipBinT3;
//   g.stutterFadeCHs = stutterFadeCHs;
//   g.stutterPanCHs = stutterPanCHs;
//   g.FX = FX;

//   // Export critical timing variables needed by composers
//   g.bpmRatio = bpmRatio;
//   g.bpmRatio2 = bpmRatio2;
//   g.bpmRatio3 = bpmRatio3;
//   g.measureCount = measureCount;
//   g.numerator = numerator;
//   g.beatCount = beatCount;
//   g.beatsUntilBinauralShift = beatsUntilBinauralShift;
//   g.flipBin = flipBin;
//   g.binauralFreqOffset = binauralFreqOffset;
//   g.binauralPlus = binauralPlus;
//   g.binauralMinus = binauralMinus;
//   g.cCH1 = cCH1;
//   g.cCH2 = cCH2;
//   g.cCH3 = cCH3;
//   g.lCH1 = lCH1;
//   g.lCH2 = lCH2;
//   g.lCH3 = lCH3;
//   g.lCH4 = lCH4;
//   g.lCH5 = lCH5;
//   g.lCH6 = lCH6;
//   g.rCH1 = rCH1;
//   g.rCH2 = rCH2;
//   g.rCH3 = rCH3;
//   g.rCH4 = rCH4;
//   g.rCH5 = rCH5;
//   g.rCH6 = rCH6;
//   g.allNotesOff = allNotesOff;
//   g.muteAll = muteAll;
//   g.rlFX = rlFX;
//   g.tpSec = tpSec;
//   g.tpSubsubdiv = tpSubsubdiv;
//   g.measureStart = measureStart;
//   g.beatStart = beatStart;
//   g.divStart = divStart;
//   g.subdivStart = subdivStart;
//   g.subsubdivStart = subsubdivStart;
//   g.subdivsPerDiv = subdivsPerDiv;

//   // Additional rhythm/timing globals
//   g.subdivsPerBeat = subdivsPerBeat;
//   g.subsubdivsPerSub = subsubdivsPerSub;
//   g.divsPerBeat = divsPerBeat;
//   g.tuningPitchBend = tuningPitchBend;
//   g.velocity = velocity;
//   g.beatRhythm = beatRhythm;
//   g.divRhythm = divRhythm;
//   g.subdivRhythm = subdivRhythm;
//   g.subsubdivRhythm = subsubdivRhythm;
//   g.beatsOn = beatsOn;
//   g.beatsOff = beatsOff;
//   g.divsOn = divsOn;
//   g.divsOff = divsOff;
//   g.subdivsOn = subdivsOn;
//   g.subdivsOff = subdivsOff;

//   // Core helpers commonly referenced by legacy code
//   g.m = m;
//   g.clamp = clamp;
//   g.modClamp = modClamp;
//   g.rf = rf;
//   g.ri = ri;
//   g.rv = rv;
//   g.rw = rw;
//   g.ra = ra;
//   g.randomWeightedSelection = randomWeightedSelection;
// }
// legacy g.* assignments moved into attachLegacyGlobals() above
// to avoid top-level side-effects during module initialization.
