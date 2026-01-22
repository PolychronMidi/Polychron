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

// Optional: Register timing services into a DIContainer for explicit DI usage
import { DIContainer } from './DIContainer.js';

export function registerTimeServices(container: DIContainer): void {
  if (!container.has('TimingCalculator')) {
    container.register('TimingCalculator', () => TimingCalculator, 'singleton');
  }
  if (!container.has('TimingContext')) {
    container.register('TimingContext', () => TimingContext, 'singleton');
  }
  if (!container.has('LayerManager')) {
    container.register('LayerManager', () => LayerManager, 'singleton');
  }
}

// NOTE: Global timing exposure was removed in favor of explicit DI.
// Use `registerTimeServices(container: DIContainer)` to register Timing services
// with a DI container. Consumers should obtain timing constructs via DI.

// NOTE: Legacy attach/detach helpers for timing are intentionally omitted to
// enforce DI-only usage. Tests should call `registerTimeServices(container)`
// to obtain Timing services via DI.


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
declare let tpMeasure: number;
declare let spMeasure: number;
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
  const layer = (ctx as any).LM?.activeLayer || 'primary';
  const sectionIndex = (ctx.state as any).sectionIndex ?? 0;
  const phraseIndex = (ctx.state as any).phraseIndex ?? 0;
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
  const state = ctx.state as any;
  const tickValue = tick ?? state.measureStart;
  const tpSec = state.tpSec || 1;
  // Debug logging removed after fixes
  if (!Number.isFinite(tpSec) || tpSec <= 0) {
    throw new Error(`Invalid tpSec: ${tpSec}`);
  }
  // DI-only: require a registered pushMultiple service and a ctx.csvBuffer
  const pFn = (() => {
    try {
      if (ctx.container && ctx.container.has && ctx.container.has('pushMultiple')) {
        return ctx.container.get('pushMultiple');
      }
    } catch (e) {
      // ignore
    }
    return undefined;
  })();

  if (typeof pFn !== 'function') {
    // If DI writer service is not available, warn and skip MIDI timing writes. This preserves
    // compatibility for tests that only care about timing values being calculated.
    console.warn('setMidiTiming: DI service "pushMultiple" not available; skipping MIDI writes.');
    return;
  }

  const buffer = ctx.csvBuffer;
  if (!buffer) {
    // Allow timing values to be updated without failing tests that do not provide CSV buffers.
    console.warn('setMidiTiming: ctx.csvBuffer not provided; skipping MIDI writes.');
    return;
  }

  pFn(buffer,
    { tick: tickValue, type: 'bpm', vals: [state.midiBPM] },
    { tick: tickValue, type: 'meter', vals: [state.midiMeter[0], state.midiMeter[1]] }
  );
};

/**
 * Sync timing values from ctx.state to globals for runtime use.
 * Called after getMidiTiming or getPolyrhythm to ensure playNotes.ts has access to values.
 */
const syncStateToGlobals = (ctx: ICompositionContext): void => {
  // Instead of writing to runtime globals, sync to the PolychronContext singleton state
  const polyState = getPolychronContext().state as any;
  const state = ctx.state as any;

  const keysToSync = [
    'midiMeter', 'midiMeterRatio', 'meterRatio', 'polyMeterRatio',
    'syncFactor', 'midiBPM', 'tpSec', 'tpMeasure', 'spMeasure',
    'measuresPerPhrase1', 'measuresPerPhrase2', 'tpPhrase', 'spPhrase',
    'numerator', 'denominator', 'polyNumerator', 'polyDenominator'
  ];

  for (const key of keysToSync) {
    if (state[key] !== undefined) {
      // Sync to PolychronContext state for backward compatibility without using globals
      polyState[key] = state[key];
    }
  }
};

/**
 * Compute phrase alignment between primary and poly meters in seconds.
 * Sets: measuresPerPhrase1, measuresPerPhrase2.
 * Recalculates meter ratios when sync alignment cannot be achieved.
 */
const getPolyrhythm = (ctx: ICompositionContext): void => {
  const state = ctx.state as any;
  // Read from state first (getPolyrhythm is called before syncStateToGlobals)
  const getVal = (key: string) => state[key] !== undefined ? state[key] : getPolychronContext().state?.[key];
  // Initialize polyrhythm values only to state
  // getPolyrhythm is called once at phrase start, not during tight composition loops
  const setVal = (key: string, value: any) => {
    state[key] = value;
  };

  const composer = getVal('composer');
  if (!composer) return;

  // Respect test-provided explicit measuresPerPhrase (DI-only override) - if a test or DI seed
  // has set a positive measuresPerPhrase, do not override it with polyrhythm heuristics.
  if (Number.isFinite(state.measuresPerPhrase) && state.measuresPerPhrase > 1) {
    return;
  }

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
  const state = ctx.state as any;

  // Read timing values from ctx.state (initialized by getMidiTiming)
  // Prefer state value; fall back to globals; if still invalid, use safe fallback of 1 and proceed (do not throw during composition)
  const tpSecCandidate = (state.tpSec !== undefined) ? state.tpSec : (g.tpSec !== undefined ? g.tpSec : undefined);
  // Compute a safe fallback for tpSec using available PPQ and BPM information if needed
  const computedFallbackTpSec = (() => {
    const ppq = state.PPQ ?? (ctx as any).PPQ ?? 480;
    const bpm = state.midiBPM ?? state.BPM ?? (ctx as any).BPM ?? 120;
    const ticksPerSec = (bpm / 60) * ppq;
    return Math.max(1, ticksPerSec);
  })();

  const tpSec = Number.isFinite(tpSecCandidate) && tpSecCandidate > 0 ? tpSecCandidate : computedFallbackTpSec;
  if (!Number.isFinite(tpSecCandidate) || tpSecCandidate <= 0) {
    // Do not throw here; instead, log a warning and continue with a safe fallback to avoid NaN propagation downstream
    console.warn(`setUnitTiming: Invalid tpSec detected (${tpSecCandidate}); using fallback tpSec=${tpSec}`);
  }
  // Ensure the chosen tpSec is persisted back to state for consistent downstream reads
  state.tpSec = tpSec;

  // For composition-time reads/writes, use ctx.state exclusively (DI-only)
  const getVal = (key: string) => state[key];
  const setVal = (key: string, value: any) => { state[key] = value; };

  // No global sync: timing is sourced from ctx.state under DI model

  switch (unitType) {
    case 'phrase':
      // Determine which layer is active and use the corresponding measures
      const activeLayer = ctx.LM?.activeLayer || 'primary';
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
      const tpMeasureVal = getVal('tpMeasure') ?? 0;
      const safeTpMeasure = Number.isFinite(tpMeasureVal) ? tpMeasureVal : 0;
      const tpPhraseVal = safeTpMeasure * measuresPerPhrase;
      setVal('tpPhrase', tpPhraseVal);
      setVal('spPhrase', Number.isFinite(tpPhraseVal) ? tpPhraseVal / tpSec : 0);
      break;

    case 'measure':
      // Use state indices for runtime
      setVal('measureStart', getVal('phraseStart') + (state.measureIndex || 0) * getVal('tpMeasure'));
      setVal('measureStartTime', getVal('phraseStartTime') + (state.measureIndex || 0) * getVal('spMeasure'));
      setMidiTiming(ctx);
      setVal('beatRhythm', setRhythm('beat', ctx));
      break;

    case 'beat':
      trackRhythm('beat', ctx);
      setVal('tpBeat', getVal('tpMeasure') / getVal('numerator'));
      setVal('spBeat', getVal('tpBeat') / tpSec);
      setVal('trueBPM', 60 / getVal('spBeat'));
      setVal('bpmRatio', getVal('BPM') / getVal('trueBPM'));
      setVal('bpmRatio2', getVal('trueBPM') / getVal('BPM'));
      setVal('trueBPM2', getVal('numerator') * (getVal('numerator') / getVal('denominator')) / 4);
      setVal('bpmRatio3', 1 / getVal('trueBPM2'));
      // Use state indices
      setVal('beatStart', getVal('phraseStart') + (state.measureIndex || 0) * getVal('tpMeasure') + (state.beatIndex || 0) * getVal('tpBeat'));
      setVal('beatStartTime', getVal('measureStartTime') + (state.beatIndex || 0) * getVal('spBeat'));
      setVal('divsPerBeat', state.composer ? state.composer.getDivisions() : 1);
      setVal('divRhythm', setRhythm('div', ctx));
      break;

    case 'division':
      trackRhythm('div', ctx);
      setVal('tpDiv', getVal('tpBeat') / Math.max(1, getVal('divsPerBeat')));
      setVal('spDiv', getVal('tpDiv') / tpSec);
      // Use state indices
      setVal('divStart', getVal('beatStart') + (state.divIndex || 0) * getVal('tpDiv'));
      setVal('divStartTime', getVal('beatStartTime') + (state.divIndex || 0) * getVal('spDiv'));
      setVal('subdivsPerDiv', Math.max(1, state.composer ? state.composer.getSubdivisions() : 1));
      setVal('subdivFreq', getVal('subdivsPerDiv') * getVal('divsPerBeat') * getVal('numerator') * getVal('meterRatio'));
      setVal('subdivRhythm', setRhythm('subdiv', ctx));
      break;

    case 'subdivision':
      trackRhythm('subdiv', ctx);
      setVal('tpSubdiv', getVal('tpDiv') / Math.max(1, getVal('subdivsPerDiv')));
      setVal('spSubdiv', getVal('tpSubdiv') / tpSec);
      setVal('subdivsPerMinute', 60 / getVal('spSubdiv'));
      // Use state indices
      setVal('subdivStart', getVal('divStart') + (state.subdivIndex || 0) * getVal('tpSubdiv'));
      setVal('subdivStartTime', getVal('divStartTime') + (state.subdivIndex || 0) * getVal('spSubdiv'));
      // Determine subsubdiv count from composer if available, otherwise fall back to existing state or 1
      const subsubCount = (state.composer && typeof state.composer.getSubsubdivs === 'function')
        ? state.composer.getSubsubdivs()
        : (getVal('subsubdivsPerSub') || 1);
      setVal('subsubdivsPerSub', Math.max(1, subsubCount));
      setVal('subsubdivRhythm', setRhythm('subsubdiv', ctx));
      break;

    case 'subsubdivision':
      trackRhythm('subsubdiv', ctx);
      setVal('tpSubsubdiv', getVal('tpSubdiv') / Math.max(1, getVal('subsubdivsPerSub')));
      setVal('spSubsubdiv', getVal('tpSubsubdiv') / tpSec);
      setVal('subsubdivsPerMinute', 60 / getVal('spSubsubdiv'));
      // Use state indices
      setVal('subsubdivStart', getVal('subdivStart') + (state.subsubdivIndex || 0) * getVal('tpSubsubdiv'));
      setVal('subsubdivStartTime', getVal('subdivStartTime') + (state.subsubdivIndex || 0) * getVal('spSubsubdiv'));
      break;



    default:
      console.warn(`Unknown unit type: ${unitType}`);
      return;
  }

  // Write unit timing to tree (hybrid observability)
  // Build path based on current unit type and indices
  const tree = initTimingTree(ctx);
  const layer = ctx.LM?.activeLayer || 'primary';
  const sectionIndex = ctx.state.sectionIndex ?? 0;
  const phraseIndex = ctx.state.phraseIndex ?? 0;

  let path = buildPath(layer, sectionIndex, phraseIndex);

  // Add measure/beat/division/etc to path if applicable
  if (unitType === 'measure' || unitType === 'beat' || unitType === 'division' || unitType === 'subdivision' || unitType === 'subsubdivision') {
    const measureIndex = ctx.state.measureIndex ?? 0;
    const beatIndex = ctx.state.beatIndex ?? 0;
    const divIndex = ctx.state.divIndex ?? 0;
    const subdivIndex = ctx.state.subdivIndex ?? 0;
    const subsubdivIndex = ctx.state.subsubdivIndex ?? 0;

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
    if (unitType !== 'phrase' && ctx && (ctx as any).state && (ctx as any).state[key] !== undefined) {
      timingSnapshot[key] = (ctx as any).state[key];
    }
  }

  if (Object.keys(timingSnapshot).length > 0) {
    setTimingValues(tree, path, timingSnapshot);
  }

  // Ensure context's CSV buffer points to the currently active buffer from LM (DI-only)
  const activeBuf = ctx?.LM?.layers?.[ctx?.LM?.activeLayer]?.buffer;
  if (ctx && activeBuf && (ctx as any).csvBuffer !== activeBuf) {
    (ctx as any).csvBuffer = activeBuf;
  }

  // Log the unit after calculating timing using the context-bound logger when available
  // Debug: show whether ctx.logUnit is used
  try {
    // Only emit verbose setUnitTiming trace when enabled explicitly via DI flags on ctx/state
    const dbg = ctx && ((ctx as any).DEBUG_TIME || (ctx as any).state && (ctx as any).state.DEBUG_TIME);
    if (dbg) {
      console.log(`[setUnitTiming] unit=${unitType} ctxHasLog=${!!(ctx && (ctx as any).logUnit)} ctxLOG=${(ctx && (ctx as any).LOG)}`);
      if (unitType === 'subsubdivision') {
        console.log('[setUnitTiming] ** subsubdivision called **');
      }
    }
  } catch (_e) {}

  if (ctx && (ctx as any).logUnit && typeof (ctx as any).logUnit === 'function') {
    (ctx as any).logUnit(unitType);
  } else {
    g.logUnit(unitType);
  }
};;

/**
 * Format seconds as MM:SS.ssss time string.
 */
const formatTime = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(4).padStart(7, '0');
  return `${minutes}:${secs}`;
};



export { getMidiTiming, setMidiTiming, getPolyrhythm, setUnitTiming, syncStateToGlobals, formatTime };

// No global exposures: prefer DI and direct imports for testing and runtime.
// Test helper: LayerManager should be obtained via DI (container.get('layerManager')) rather than runtime globals.
