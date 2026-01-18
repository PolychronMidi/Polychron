// time.ts - Timing engine with meter spoofing and dual-layer polyrhythm support.
// minimalist comments, details at: time.md

import { TimingCalculator } from './time/TimingCalculator.js';
import { TimingContext } from './time/TimingContext.js';
import { LayerManager } from './time/LayerManager.js';
import { setRhythm, trackRhythm } from './rhythm.js';
import { ri, rf, rw, clamp } from './utils.js';
import { ICompositionContext } from './CompositionContext.js';
import { initTimingTree, buildPath, setTimingValues } from './TimingTree.js';
import { logUnit } from './writer.js';

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

let timingCalculator: TimingCalculator | null = null;

/**
 * Compute MIDI-compatible meter and tempo sync factor.
 * Sets: midiMeter, midiMeterRatio, syncFactor, midiBPM, tpSec, tpMeasure, spMeasure.
 * Also writes to timing tree for observability.
 */
const getMidiTiming = (ctx: ICompositionContext): [number, number] => {
  const g = globalThis as any;
  const state = ctx.state as any;

  const bpm = ctx.BPM;
  const ppq = ctx.PPQ;
  const currentNumerator = state.numerator;
  const currentDenominator = state.denominator;

  timingCalculator = new TimingCalculator({ bpm, ppq, meter: [currentNumerator, currentDenominator] });

  // Initialize timing values only to state
  // getMidiTiming is called once at section start, not during composition loops
  state.midiMeter = timingCalculator.midiMeter;
  state.midiMeterRatio = timingCalculator.midiMeterRatio;
  state.meterRatio = timingCalculator.meterRatio;
  state.syncFactor = timingCalculator.syncFactor;
  state.midiBPM = timingCalculator.midiBPM;
  state.tpSec = timingCalculator.tpSec;
  state.tpMeasure = timingCalculator.tpMeasure;
  state.spMeasure = timingCalculator.spMeasure;

  // Write to timing tree for observability (hybrid approach: globals + tree)
  const tree = initTimingTree(ctx);
  const layer = g.LM?.activeLayer || 'primary';
  const sectionIndex = g.sectionIndex ?? 0;
  const phraseIndex = g.phraseIndex ?? 0;
  const path = buildPath(layer, sectionIndex, phraseIndex);
  setTimingValues(tree, path, {
    midiMeter: timingCalculator.midiMeter,
    midiMeterRatio: timingCalculator.midiMeterRatio,
    meterRatio: timingCalculator.meterRatio,
    syncFactor: timingCalculator.syncFactor,
    midiBPM: timingCalculator.midiBPM,
    tpSec: timingCalculator.tpSec,
    tpMeasure: timingCalculator.tpMeasure,
    spMeasure: timingCalculator.spMeasure,
    numerator: currentNumerator,
    denominator: currentDenominator
  });

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
 * Sync timing values from ctx.state to globals for runtime use.
 * Called after getMidiTiming or getPolyrhythm to ensure playNotes.ts has access to values.
 */
const syncStateToGlobals = (ctx: ICompositionContext): void => {
  const g = globalThis as any;
  const state = ctx.state as any;

  const keysToSync = [
    'midiMeter', 'midiMeterRatio', 'meterRatio', 'polyMeterRatio',
    'syncFactor', 'midiBPM', 'tpSec', 'tpMeasure', 'spMeasure',
    'measuresPerPhrase1', 'measuresPerPhrase2', 'tpPhrase', 'spPhrase',
    'numerator', 'denominator', 'polyNumerator', 'polyDenominator'
  ];

  for (const key of keysToSync) {
    if (state[key] !== undefined) {
      g[key] = state[key];
    }
  }
};

/**
 * Compute phrase alignment between primary and poly meters in seconds.
 * Sets: measuresPerPhrase1, measuresPerPhrase2.
 * Recalculates meter ratios when sync alignment cannot be achieved.
 */
const getPolyrhythm = (ctx: ICompositionContext): void => {
  const g = globalThis as any;
  const state = ctx.state as any;
  // Read from state first (getPolyrhythm is called before syncStateToGlobals)
  const getVal = (key: string) => state[key] !== undefined ? state[key] : g[key];
  // Initialize polyrhythm values only to state
  // getPolyrhythm is called once at phrase start, not during tight composition loops
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

    // Check if we have a valid polyrhythm alignment
    const hasPolyrhythm = !(getVal('numerator') === getVal('polyNumerator') && getVal('denominator') === getVal('polyDenominator'));
    const hasValidMatch = bestMatch.totalMeasures !== Infinity &&
        (bestMatch.totalMeasures > 2 &&
         (bestMatch.primaryMeasures > 1 || bestMatch.polyMeasures > 1));
    
    if (hasValidMatch && hasPolyrhythm) {
      // Found a polyrhythmic alignment
      setVal('measuresPerPhrase1', bestMatch.primaryMeasures);
      setVal('measuresPerPhrase2', bestMatch.polyMeasures);
      return;
    } else if (!hasPolyrhythm) {
      // Meters are identical - no polyrhythm needed, both use 1 measure per phrase
      setVal('measuresPerPhrase1', 1);
      setVal('measuresPerPhrase2', 1);
      return;
    } else if (hasValidMatch && !hasPolyrhythm) {
      // This shouldn't happen, but just in case: valid match but same meters
      setVal('measuresPerPhrase1', 1);
      setVal('measuresPerPhrase2', 1);
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

  // Write polyrhythm to timing tree (hybrid observability)
  const tree = initTimingTree(ctx);
  const layer = g.LM?.activeLayer || 'primary';
  const sectionIndex = g.sectionIndex ?? 0;
  const phraseIndex = g.phraseIndex ?? 0;
  const path = buildPath(layer, sectionIndex, phraseIndex);
  setTimingValues(tree, path, {
    polyNumerator: getVal('polyNumerator'),
    polyDenominator: getVal('polyDenominator'),
    polyMeterRatio: getVal('polyMeterRatio'),
    measuresPerPhrase1: getVal('measuresPerPhrase1'),
    measuresPerPhrase2: getVal('measuresPerPhrase2')
  });
};

/**
 * Set timing variables for each unit level. Calculates absolute positions using
 * cascading parent position plus index times duration pattern. See time.md for details.
 * @param {string} unitType - One of: 'phrase', 'measure', 'beat', 'division', 'subdivision', 'subsubdivision'.
 */
const setUnitTiming = (unitType: string, ctx: ICompositionContext): void => {
  const g = globalThis as any;
  const state = ctx.state as any;

  // Read timing values from ctx.state (initialized by getMidiTiming)
  const tpSec = state.tpSec || g.tpSec;

  if (!Number.isFinite(tpSec) || tpSec <= 0) {
    throw new Error(`Invalid tpSec in setUnitTiming: ${tpSec}`);
  }

  // For composition-time reads, prefer ctx.state, fallback to globals
  const getVal = (key: string) => state[key] !== undefined ? state[key] : g[key];
  const setVal = (key: string, value: any) => {
    state[key] = value;
    g[key] = value;  // Still write to globals for runtime (playNotes.ts reads from globals)
  };

  switch (unitType) {
    case 'phrase':
      // Determine which layer is active and use the corresponding measures
      const activeLayer = g.LM?.activeLayer || 'primary';
      let measuresPerPhrase = 1;

      if (activeLayer === 'poly') {
        measuresPerPhrase = getVal('measuresPerPhrase2') || getVal('measuresPerPhrase') || 1;
      } else {
        measuresPerPhrase = getVal('measuresPerPhrase1') || getVal('measuresPerPhrase') || 1;
      }

      if (!Number.isFinite(measuresPerPhrase) || measuresPerPhrase < 1) {
        measuresPerPhrase = 1;
      }
      setVal('measuresPerPhrase', measuresPerPhrase);
      setVal('tpPhrase', getVal('tpMeasure') * measuresPerPhrase);
      setVal('spPhrase', getVal('tpPhrase') / tpSec);
      break;

    case 'measure':
      setVal('measureStart', getVal('phraseStart') + getVal('measureIndex') * getVal('tpMeasure'));
      setVal('measureStartTime', getVal('phraseStartTime') + getVal('measureIndex') * getVal('spMeasure'));
      setMidiTiming(ctx);
      setVal('beatRhythm', setRhythm('beat'));
      break;

    case 'beat':
      trackRhythm('beat');
      setVal('tpBeat', getVal('tpMeasure') / getVal('numerator'));
      setVal('spBeat', getVal('tpBeat') / tpSec);
      setVal('trueBPM', 60 / getVal('spBeat'));
      setVal('bpmRatio', getVal('BPM') / getVal('trueBPM'));
      setVal('bpmRatio2', getVal('trueBPM') / getVal('BPM'));
      setVal('trueBPM2', getVal('numerator') * (getVal('numerator') / getVal('denominator')) / 4);
      setVal('bpmRatio3', 1 / getVal('trueBPM2'));
      setVal('beatStart', getVal('phraseStart') + getVal('measureIndex') * getVal('tpMeasure') + getVal('beatIndex') * getVal('tpBeat'));
      setVal('beatStartTime', getVal('measureStartTime') + getVal('beatIndex') * getVal('spBeat'));
      setVal('divsPerBeat', g.composer ? g.composer.getDivisions() : 1);
      setVal('divRhythm', setRhythm('div'));
      break;

    case 'division':
      trackRhythm('div');
      setVal('tpDiv', getVal('tpBeat') / Math.max(1, getVal('divsPerBeat')));
      setVal('spDiv', getVal('tpDiv') / tpSec);
      setVal('divStart', getVal('beatStart') + getVal('divIndex') * getVal('tpDiv'));
      setVal('divStartTime', getVal('beatStartTime') + getVal('divIndex') * getVal('spDiv'));
      setVal('subdivsPerDiv', Math.max(1, g.composer ? g.composer.getSubdivisions() : 1));
      setVal('subdivFreq', getVal('subdivsPerDiv') * getVal('divsPerBeat') * getVal('numerator') * getVal('meterRatio'));
      setVal('subdivRhythm', setRhythm('subdiv'));
      break;

    case 'subdivision':
      trackRhythm('subdiv');
      setVal('tpSubdiv', getVal('tpDiv') / Math.max(1, getVal('subdivsPerDiv')));
      setVal('spSubdiv', getVal('tpSubdiv') / tpSec);
      setVal('subdivsPerMinute', 60 / getVal('spSubdiv'));
      setVal('subdivStart', getVal('divStart') + getVal('subdivIndex') * getVal('tpSubdiv'));
      setVal('subdivStartTime', getVal('divStartTime') + getVal('subdivIndex') * getVal('spSubdiv'));
      setVal('subsubdivsPerSub', g.composer ? g.composer.getSubsubdivs() : 1);
      setVal('subsubdivRhythm', setRhythm('subsubdiv'));
      break;

    case 'subsubdivision':
      trackRhythm('subsubdiv');
      setVal('tpSubsubdiv', getVal('tpSubdiv') / Math.max(1, getVal('subsubdivsPerSub')));
      setVal('spSubsubdiv', getVal('tpSubsubdiv') / tpSec);
      setVal('subsubdivsPerMinute', 60 / getVal('spSubsubdiv'));
      setVal('subsubdivStart', getVal('subdivStart') + getVal('subsubdivIndex') * getVal('tpSubsubdiv'));
      setVal('subsubdivStartTime', getVal('subdivStartTime') + getVal('subsubdivIndex') * getVal('spSubsubdiv'));
      break;

    default:
      console.warn(`Unknown unit type: ${unitType}`);
      return;
  }

  // Write unit timing to tree (hybrid observability)
  // Build path based on current unit type and indices
  const tree = initTimingTree(ctx);
  const layer = g.LM?.activeLayer || 'primary';
  const sectionIndex = g.sectionIndex ?? 0;
  const phraseIndex = g.phraseIndex ?? 0;

  let path = buildPath(layer, sectionIndex, phraseIndex);

  // Add measure/beat/division/etc to path if applicable
  if (unitType === 'measure' || unitType === 'beat' || unitType === 'division' || unitType === 'subdivision' || unitType === 'subsubdivision') {
    const measureIndex = g.measureIndex ?? 0;
    const beatIndex = g.beatIndex ?? 0;
    const divIndex = g.divIndex ?? 0;
    const subdivIndex = g.subdivIndex ?? 0;
    const subsubdivIndex = g.subsubdivIndex ?? 0;

    path = buildPath(layer, sectionIndex, phraseIndex,
      unitType !== 'measure' ? measureIndex : undefined,
      (unitType === 'beat' || unitType === 'division' || unitType === 'subdivision' || unitType === 'subsubdivision') ? beatIndex : undefined,
      (unitType === 'division' || unitType === 'subdivision' || unitType === 'subsubdivision') ? divIndex : undefined,
      (unitType === 'subdivision' || unitType === 'subsubdivision') ? subdivIndex : undefined,
      unitType === 'subsubdivision' ? subsubdivIndex : undefined
    );
  }

  // Capture all calculated timing values
  const timingSnapshot: any = {};
  const timingKeys = [
    'tpPhrase', 'spPhrase',
    'tpMeasure', 'spMeasure',
    'measureStart', 'measureStartTime',
    'tpBeat', 'spBeat', 'beatStart', 'beatStartTime', 'trueBPM', 'bpmRatio', 'bpmRatio2', 'bpmRatio3', 'divsPerBeat',
    'tpDiv', 'spDiv', 'divStart', 'divStartTime', 'subdivsPerDiv',
    'tpSubdiv', 'spSubdiv', 'subdivStart', 'subdivStartTime',
    'tpSubsubdiv', 'spSubsubdiv', 'subsubdivStart', 'subsubdivStartTime'
  ];

  for (const key of timingKeys) {
    if (key in g && unitType !== 'phrase') {
      timingSnapshot[key] = g[key];
    }
  }

  if (Object.keys(timingSnapshot).length > 0) {
    setTimingValues(tree, path, timingSnapshot);
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



export { getMidiTiming, setMidiTiming, getPolyrhythm, setUnitTiming, syncStateToGlobals, formatTime };

// Attach to globalThis for backward compatibility
(globalThis as any).getMidiTiming = getMidiTiming;
(globalThis as any).syncStateToGlobals = syncStateToGlobals;
(globalThis as any).setMidiTiming = setMidiTiming;
(globalThis as any).getPolyrhythm = getPolyrhythm;
(globalThis as any).setUnitTiming = setUnitTiming;
(globalThis as any).formatTime = formatTime;
(globalThis as any).setRhythm = setRhythm;
(globalThis as any).trackRhythm = trackRhythm;
(globalThis as any).logUnit = logUnit;
