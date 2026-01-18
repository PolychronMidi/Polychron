// time.ts - Timing engine with meter spoofing and dual-layer polyrhythm support.
// minimalist comments, details at: time.md

import { TimingCalculator } from './time/TimingCalculator.js';
import { TimingContext } from './time/TimingContext.js';
import { LayerManager } from './time/LayerManager.js';
import { setRhythm, trackRhythm } from './rhythm.js';
import { ri, rf, rw, clamp } from './utils.js';
import { ICompositionContext } from './CompositionContext.js';

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
const getMidiTiming = (ctx: ICompositionContext): [number, number] => {
  const state = ctx.state as any;

  const bpm = ctx.BPM;
  const ppq = ctx.PPQ;
  const currentNumerator = state.numerator;
  const currentDenominator = state.denominator;

  timingCalculator = new TimingCalculator({ bpm, ppq, meter: [currentNumerator, currentDenominator] });

  const assignVal = (key: string, value: any) => {
    state[key] = value;
  };

  assignVal('midiMeter', timingCalculator.midiMeter);
  assignVal('midiMeterRatio', timingCalculator.midiMeterRatio);
  assignVal('meterRatio', timingCalculator.meterRatio);
  assignVal('syncFactor', timingCalculator.syncFactor);
  assignVal('midiBPM', timingCalculator.midiBPM);
  assignVal('tpSec', timingCalculator.tpSec);
  assignVal('tpMeasure', timingCalculator.tpMeasure);
  assignVal('spMeasure', timingCalculator.spMeasure);

  return timingCalculator.midiMeter;
};

/**
 * Writes MIDI timing events to active buffer (c).
 * Context-aware: writes to c1 or c2 depending on current meter.
 * @param {ICompositionContext} ctx - Composition context
 * @param {number} [tick] - Starting tick position, defaults to current measure start.
 */
const setMidiTiming = (ctx: ICompositionContext, tick?: number): void => {
  const g = globalThis as any;
  const state = ctx.state as any;
  const tickValue = tick ?? state.measureStart;
  if (!Number.isFinite(state.tpSec) || state.tpSec <= 0) {
    throw new Error(`Invalid tpSec: ${state.tpSec}`);
  }
  g.p(g.c,
    { tick: tickValue, type: 'bpm', vals: [state.midiBPM] },
    { tick: tickValue, type: 'meter', vals: [state.midiMeter[0], state.midiMeter[1]] },
  );
};

/**
 * Compute phrase alignment between primary and poly meters in seconds.
 * Sets: measuresPerPhrase1, measuresPerPhrase2.
 * Recalculates meter ratios when sync alignment cannot be achieved.
 */
const getPolyrhythm = (ctx: ICompositionContext): void => {
  const g = globalThis as any;
  const state = ctx.state as any;
  const getVal = (key: string) => state[key];
  const setVal = (key: string, value: any) => {
    state[key] = value;
  };

  const composer = getVal('composer');
  if (!composer) return;

  const MAX_ATTEMPTS = 100;
  let attempts = 0;

  while (attempts++ < MAX_ATTEMPTS) {
    const [polyNum, polyDen] = composer.getMeter(true, true);
    setVal('polyNumerator', polyNum);
    setVal('polyDenominator', polyDen);

    if (!Number.isFinite(polyNum) || !Number.isFinite(polyDen) || polyDen <= 0) {
      continue;
    }

    setVal('polyMeterRatio', polyNum / polyDen);
    let allMatches: any[] = [];
    let bestMatch = {
      primaryMeasures: Infinity,
      polyMeasures: Infinity,
      totalMeasures: Infinity,
      polyNumerator: getVal('polyNumerator'),
      polyDenominator: getVal('polyDenominator')
    };

    for (let primaryMeasures = 1; primaryMeasures < 7; primaryMeasures++) {
      for (let polyMeasures = 1; polyMeasures < 7; polyMeasures++) {
        if (Math.abs(primaryMeasures * getVal('meterRatio') - polyMeasures * getVal('polyMeterRatio')) < 0.00000001) {
          let currentMatch = {
            primaryMeasures: primaryMeasures,
            polyMeasures: polyMeasures,
            totalMeasures: primaryMeasures + polyMeasures,
            polyNumerator: getVal('polyNumerator'),
            polyDenominator: getVal('polyDenominator')
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
        !(getVal('numerator') === getVal('polyNumerator') && getVal('denominator') === getVal('polyDenominator'))) {
      setVal('measuresPerPhrase1', bestMatch.primaryMeasures);
      setVal('measuresPerPhrase2', bestMatch.polyMeasures);
      return;
    }
  }

  // Max attempts reached: try new meter on primary layer with relaxed constraints
  console.warn(`getPolyrhythm() reached max attempts (${MAX_ATTEMPTS}); requesting new primary meter...`);
  const [newNumerator, newDenominator] = composer.getMeter(true, false);
  setVal('numerator', newNumerator);
  setVal('denominator', newDenominator);
  // CRITICAL: Recalculate all timing after meter change to prevent sync desync
  getMidiTiming(ctx);
  setVal('measuresPerPhrase1', 1);
  setVal('measuresPerPhrase2', 1);
};

/**
 * Set timing variables for each unit level. Calculates absolute positions using
 * cascading parent position plus index times duration pattern. See time.md for details.
 * @param {string} unitType - One of: 'phrase', 'measure', 'beat', 'division', 'subdivision', 'subsubdivision'.
 */
const setUnitTiming = (unitType: string, ctx: ICompositionContext): void => {
  const g = globalThis as any;
  const state = ctx.state as any;

  if (!Number.isFinite(g.tpSec) || g.tpSec <= 0) {
    throw new Error(`Invalid tpSec in setUnitTiming: ${g.tpSec}`);
  }

  // Read from globals (LM.activate() restores layer state to globals)
  // Write to BOTH globals and ctx.state for DI compatibility and test support
  const syncValue = (key: string, value: any) => {
    g[key] = value;
    state[key] = value;
  };

  switch (unitType) {
    case 'phrase':
      if (!Number.isFinite(g.measuresPerPhrase) || g.measuresPerPhrase < 1) {
        syncValue('measuresPerPhrase', 1);
      }
      syncValue('tpPhrase', g.tpMeasure * g.measuresPerPhrase);
      syncValue('spPhrase', g.tpPhrase / g.tpSec);
      break;

    case 'measure':
      syncValue('measureStart', g.phraseStart + g.measureIndex * g.tpMeasure);
      syncValue('measureStartTime', g.phraseStartTime + g.measureIndex * g.spMeasure);
      setMidiTiming(ctx);
      syncValue('beatRhythm', setRhythm('beat'));
      break;

    case 'beat':
      trackRhythm('beat');
      syncValue('tpBeat', g.tpMeasure / g.numerator);
      syncValue('spBeat', g.tpBeat / g.tpSec);
      syncValue('trueBPM', 60 / g.spBeat);
      syncValue('bpmRatio', g.BPM / g.trueBPM);
      syncValue('bpmRatio2', g.trueBPM / g.BPM);
      syncValue('trueBPM2', g.numerator * (g.numerator / g.denominator) / 4);
      syncValue('bpmRatio3', 1 / g.trueBPM2);
      syncValue('beatStart', g.phraseStart + g.measureIndex * g.tpMeasure + g.beatIndex * g.tpBeat);
      syncValue('beatStartTime', g.measureStartTime + g.beatIndex * g.spBeat);
      syncValue('divsPerBeat', g.composer ? g.composer.getDivisions() : 1);
      syncValue('divRhythm', setRhythm('div'));
      break;

    case 'division':
      trackRhythm('div');
      syncValue('tpDiv', g.tpBeat / Math.max(1, g.divsPerBeat));
      syncValue('spDiv', g.tpDiv / g.tpSec);
      syncValue('divStart', g.beatStart + g.divIndex * g.tpDiv);
      syncValue('divStartTime', g.beatStartTime + g.divIndex * g.spDiv);
      syncValue('subdivsPerDiv', Math.max(1, g.composer ? g.composer.getSubdivisions() : 1));
      syncValue('subdivFreq', g.subdivsPerDiv * g.divsPerBeat * g.numerator * g.meterRatio);
      syncValue('subdivRhythm', setRhythm('subdiv'));
      break;

    case 'subdivision':
      trackRhythm('subdiv');
      syncValue('tpSubdiv', g.tpDiv / Math.max(1, g.subdivsPerDiv));
      syncValue('spSubdiv', g.tpSubdiv / g.tpSec);
      syncValue('subdivsPerMinute', 60 / g.spSubdiv);
      syncValue('subdivStart', g.divStart + g.subdivIndex * g.tpSubdiv);
      syncValue('subdivStartTime', g.divStartTime + g.subdivIndex * g.spSubdiv);
      syncValue('subsubdivsPerSub', g.composer ? g.composer.getSubsubdivs() : 1);
      syncValue('subsubdivRhythm', setRhythm('subsubdiv'));
      break;

    case 'subsubdivision':
      trackRhythm('subsubdiv');
      syncValue('tpSubsubdiv', g.tpSubdiv / Math.max(1, g.subsubdivsPerSub));
      syncValue('spSubsubdiv', g.tpSubsubdiv / g.tpSec);
      syncValue('subsubdivsPerMinute', 60 / g.spSubsubdiv);
      syncValue('subsubdivStart', g.subdivStart + g.subsubdivIndex * g.tpSubsubdiv);
      syncValue('subsubdivStartTime', g.subdivStartTime + g.subsubdivIndex * g.spSubsubdiv);
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
