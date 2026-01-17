// time.ts - Timing engine with meter spoofing and dual-layer polyrhythm support.
// minimalist comments, details at: time.md

import { TimingCalculator } from './time/TimingCalculator.js';
import { TimingContext } from './time/TimingContext.js';
import { LayerManager } from './time/LayerManager.js';
import { setRhythm, trackRhythm } from './rhythm.js';

export { TimingCalculator, TimingContext, LayerManager };

// Attach to globalThis for backward compatibility
(globalThis as any).LayerManager = LayerManager;
(globalThis as any).LM = LayerManager; // Alias for convenience
(globalThis as any).TimingContext = TimingContext;
(globalThis as any).TimingCalculator = TimingCalculator;

// Declare global timing variables
declare const BPM: number;
declare const PPQ: number;
declare let numerator: number;
declare let denominator: number;
declare let polyNumerator: number;
declare let polyDenominator: number;
declare let midiMeter: [number, number];
declare let midiMeterRatio: number;
declare let meterRatio: number;
declare let polyMeterRatio: number;
declare let syncFactor: number;
declare let midiBPM: number;
declare let tpSec: number;
declare let tpMeasure: number;
declare let spMeasure: number;
declare let measuresPerPhrase1: number;
declare let measuresPerPhrase2: number;
declare let measuresPerPhrase: number;
declare let tpPhrase: number;
declare let spPhrase: number;
declare let measureStart: number;
declare let measureStartTime: number;
declare let measureIndex: number;
declare let beatIndex: number;
declare let divIndex: number;
declare let subdivIndex: number;
declare let subsubdivIndex: number;
declare let phraseStart: number;
declare let phraseStartTime: number;
declare let sectionStart: number;
declare let sectionStartTime: number;
declare let sectionEnd: number;
declare let tpSection: number;
declare let spSection: number;
declare let beatStart: number;
declare let beatStartTime: number;
declare let tpBeat: number;
declare let spBeat: number;
declare let trueBPM: number;
declare let bpmRatio: number;
declare let bpmRatio2: number;
declare let trueBPM2: number;
declare let bpmRatio3: number;
declare let divsPerBeat: number;
declare let divStart: number;
declare let divStartTime: number;
declare let tpDiv: number;
declare let spDiv: number;
declare let subdivsPerDiv: number;
declare let subdivFreq: number;
declare let subdivStart: number;
declare let subdivStartTime: number;
declare let tpSubdiv: number;
declare let spSubdiv: number;
declare let subdivsPerMinute: number;
declare let subsubdivsPerSub: number;
declare let subsubdivStart: number;
declare let subsubdivStartTime: number;
declare let tpSubsubdiv: number;
declare let spSubsubdiv: number;
declare let subsubdivsPerMinute: number;
declare let beatRhythm: number;
declare let divRhythm: number;
declare let subdivRhythm: number;
declare let subsubdivRhythm: number;
declare const composer: any;
declare const c: any;
declare const p: any;
declare const m: typeof Math;
declare const logUnit: any;

let timingCalculator: TimingCalculator | null = null;

/**
 * Compute MIDI-compatible meter and tempo sync factor.
 * Sets: midiMeter, midiMeterRatio, syncFactor, midiBPM, tpSec, tpMeasure, spMeasure.
 */
const getMidiTiming = (): [number, number] => {
  timingCalculator = new TimingCalculator({ bpm: BPM, ppq: PPQ, meter: [numerator, denominator] });
  const g = globalThis as any;
  g.midiMeter = timingCalculator.midiMeter;
  g.midiMeterRatio = timingCalculator.midiMeterRatio;
  g.meterRatio = timingCalculator.meterRatio;
  g.syncFactor = timingCalculator.syncFactor;
  g.midiBPM = timingCalculator.midiBPM;
  g.tpSec = timingCalculator.tpSec;
  g.tpMeasure = timingCalculator.tpMeasure;
  g.spMeasure = timingCalculator.spMeasure;
  return timingCalculator.midiMeter;
};

/**
 * Writes MIDI timing events to active buffer (c).
 * Context-aware: writes to c1 or c2 depending on current meter.
 * @param {number} [tick=(globalThis.measureStart)] - Starting tick position, defaults to current measure start.
 */
const setMidiTiming = (tick: number = (globalThis as any).measureStart): void => {
  const g = globalThis as any;
  if (!Number.isFinite(g.tpSec) || g.tpSec <= 0) {
    throw new Error(`Invalid tpSec: ${g.tpSec}`);
  }
  g.p(g.c,
    { tick: tick, type: 'bpm', vals: [g.midiBPM] },
    { tick: tick, type: 'meter', vals: [g.midiMeter[0], g.midiMeter[1]] },
  );
};

/**
 * Compute phrase alignment between primary and poly meters in seconds.
 * Sets: measuresPerPhrase1, measuresPerPhrase2.
 * Recalculates meter ratios when sync alignment cannot be achieved.
 */
const getPolyrhythm = (): void => {
  const g = globalThis as any;
  if (!g.composer) return;

  const MAX_ATTEMPTS = 100;
  let attempts = 0;

  while (attempts++ < MAX_ATTEMPTS) {
    [g.polyNumerator, g.polyDenominator] = g.composer.getMeter(true, true);
    if (!Number.isFinite(g.polyNumerator) || !Number.isFinite(g.polyDenominator) || g.polyDenominator <= 0) {
      continue;
    }

    g.polyMeterRatio = g.polyNumerator / g.polyDenominator;
    let allMatches: any[] = [];
    let bestMatch = {
      primaryMeasures: Infinity,
      polyMeasures: Infinity,
      totalMeasures: Infinity,
      polyNumerator: g.polyNumerator,
      polyDenominator: g.polyDenominator
    };

    for (let primaryMeasures = 1; primaryMeasures < 7; primaryMeasures++) {
      for (let polyMeasures = 1; polyMeasures < 7; polyMeasures++) {
        if (Math.abs(primaryMeasures * g.meterRatio - polyMeasures * g.polyMeterRatio) < 0.00000001) {
          let currentMatch = {
            primaryMeasures: primaryMeasures,
            polyMeasures: polyMeasures,
            totalMeasures: primaryMeasures + polyMeasures,
            polyNumerator: g.polyNumerator,
            polyDenominator: g.polyDenominator
          };
          allMatches.push(currentMatch);
          if (currentMatch.totalMeasures < bestMatch.totalMeasures) {
            bestMatch = currentMatch;
          }
        }
      }
    }

    if (bestMatch.totalMeasures !== Infinity &&
        (bestMatch.totalMeasures > 2 &&
         (bestMatch.primaryMeasures > 1 || bestMatch.polyMeasures > 1)) &&
        !(g.numerator === g.polyNumerator && g.denominator === g.polyDenominator)) {
      g.measuresPerPhrase1 = bestMatch.primaryMeasures;
      g.measuresPerPhrase2 = bestMatch.polyMeasures;
      return;
    }
  }

  // Max attempts reached: try new meter on primary layer with relaxed constraints
  console.warn(`getPolyrhythm() reached max attempts (${MAX_ATTEMPTS}); requesting new primary meter...`);
  [g.numerator, g.denominator] = g.composer.getMeter(true, false);
  // CRITICAL: Recalculate all timing after meter change to prevent sync desync
  getMidiTiming();
  g.measuresPerPhrase1 = 1;
  g.measuresPerPhrase2 = 1;
};

/**
 * Set timing variables for each unit level. Calculates absolute positions using
 * cascading parent position plus index times duration pattern. See time.md for details.
 * @param {string} unitType - One of: 'phrase', 'measure', 'beat', 'division', 'subdivision', 'subsubdivision'.
 */
const setUnitTiming = (unitType: string): void => {
  const g = globalThis as any;

  if (!Number.isFinite(g.tpSec) || g.tpSec <= 0) {
    throw new Error(`Invalid tpSec in setUnitTiming: ${g.tpSec}`);
  }

  // Use globals (not layer.state) because LM.activate() already restored layer state to globals.
  // This ensures consistent timing across all unit calculations in cascading hierarchy.

  switch (unitType) {
    case 'phrase':
      if (!Number.isFinite(g.measuresPerPhrase) || g.measuresPerPhrase < 1) {
        g.measuresPerPhrase = 1;
      }
      g.tpPhrase = g.tpMeasure * g.measuresPerPhrase;
      g.spPhrase = g.tpPhrase / g.tpSec;
      break;

    case 'measure':
      g.measureStart = g.phraseStart + g.measureIndex * g.tpMeasure;
      g.measureStartTime = g.phraseStartTime + g.measureIndex * g.spMeasure;
      setMidiTiming();
      g.beatRhythm = setRhythm('beat');
      break;

    case 'beat':
      trackRhythm('beat');
      g.tpBeat = g.tpMeasure / g.numerator;
      g.spBeat = g.tpBeat / g.tpSec;
      g.trueBPM = 60 / g.spBeat;
      g.bpmRatio = g.BPM / g.trueBPM;
      g.bpmRatio2 = g.trueBPM / g.BPM;
      g.trueBPM2 = g.numerator * (g.numerator / g.denominator) / 4;
      g.bpmRatio3 = 1 / g.trueBPM2;
      g.beatStart = g.phraseStart + g.measureIndex * g.tpMeasure + g.beatIndex * g.tpBeat;
      g.beatStartTime = g.measureStartTime + g.beatIndex * g.spBeat;
      g.divsPerBeat = g.composer ? g.composer.getDivisions() : 1;
      g.divRhythm = setRhythm('div');
      break;

    case 'division':
      trackRhythm('div');
      g.tpDiv = g.tpBeat / Math.max(1, g.divsPerBeat);
      g.spDiv = g.tpDiv / g.tpSec;
      g.divStart = g.beatStart + g.divIndex * g.tpDiv;
      g.divStartTime = g.beatStartTime + g.divIndex * g.spDiv;
      g.subdivsPerDiv = Math.max(1, g.composer ? g.composer.getSubdivisions() : 1);
      g.subdivFreq = g.subdivsPerDiv * g.divsPerBeat * g.numerator * g.meterRatio;
      g.subdivRhythm = setRhythm('subdiv');
      break;

    case 'subdivision':
      trackRhythm('subdiv');
      g.tpSubdiv = g.tpDiv / Math.max(1, g.subdivsPerDiv);
      g.spSubdiv = g.tpSubdiv / g.tpSec;
      g.subdivsPerMinute = 60 / g.spSubdiv;
      g.subdivStart = g.divStart + g.subdivIndex * g.tpSubdiv;
      g.subdivStartTime = g.divStartTime + g.subdivIndex * g.spSubdiv;
      g.subsubdivsPerSub = g.composer ? g.composer.getSubsubdivs() : 1;
      g.subsubdivRhythm = setRhythm('subsubdiv');
      break;

    case 'subsubdivision':
      trackRhythm('subsubdiv');
      g.tpSubsubdiv = g.tpSubdiv / Math.max(1, g.subsubdivsPerSub);
      g.spSubsubdiv = g.tpSubsubdiv / g.tpSec;
      g.subsubdivsPerMinute = 60 / g.spSubsubdiv;
      g.subsubdivStart = g.subdivStart + g.subsubdivIndex * g.tpSubsubdiv;
      g.subsubdivStartTime = g.subdivStartTime + g.subsubdivIndex * g.spSubsubdiv;
      break;

    default:
      console.warn(`Unknown unit type: ${unitType}`);
      return;
  }

  // Log the unit after calculating timing
  g.logUnit(unitType);
};

/**
 * Format seconds as MM:SS.ssss time string.
 */
const formatTime = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(4).padStart(7, '0');
  return `${minutes}:${secs}`;
};



export { getMidiTiming, setMidiTiming, getPolyrhythm, setUnitTiming, formatTime };

// Attach to globalThis for backward compatibility
(globalThis as any).getMidiTiming = getMidiTiming;
(globalThis as any).setMidiTiming = setMidiTiming;
(globalThis as any).getPolyrhythm = getPolyrhythm;
(globalThis as any).setUnitTiming = setUnitTiming;
(globalThis as any).formatTime = formatTime;
(globalThis as any).setRhythm = setRhythm;
(globalThis as any).trackRhythm = trackRhythm;
