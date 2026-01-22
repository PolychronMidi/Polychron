// writer.ts - MIDI output and file generation with CSV buffer management.
// minimalist comments, details at: writer.md

import * as fs from 'fs';
import * as path from 'path';
import { DIContainer } from './DIContainer.js';
import { ICompositionContext } from './CompositionContext.js';

/**
 * MIDI event object structure
 */
interface MIDIEvent {
  tick: number;
  type: string;
  vals: any[];
}

/**
 * Layer-aware MIDI event buffer.
 */
export class CSVBuffer {
  name: string;
  rows: MIDIEvent[];

  constructor(name: string) {
    this.name = name;
    this.rows = [];
  }

  push(...items: MIDIEvent[]): void {
    this.rows.push(...items);
  }

  get length(): number {
    return this.rows.length;
  }

  clear(): void {
    this.rows = [];
  }
}

/**
 * Push multiple items onto a buffer/array.
 */
export const pushMultiple = (buffer: CSVBuffer | any[], ...items: MIDIEvent[]): void => {
  if (buffer instanceof CSVBuffer) {
    buffer.push(...items);
  } else if (Array.isArray(buffer)) {
    buffer.push(...items);
  }
};



// Initialize buffers (c1/c2 created here, layers register them in play.js)
const c1 = new CSVBuffer('primary');
const c2 = new CSVBuffer('poly');
let c: any = c1; // Active buffer reference

// Declare global timing and state variables
declare let LOG: string;
declare let sectionIndex: number;
declare let totalSections: number;
declare let sectionStart: number;
declare let sectionStartTime: number;
declare let tpSection: number;
declare let tpSec: number;
declare let phraseIndex: number;
declare let phrasesPerSection: number;
declare let phraseStart: number;
declare let phraseStartTime: number;
declare let tpPhrase: number;
declare let measureIndex: number;
declare let measuresPerPhrase: number;
declare let measureStart: number;
declare let measureStartTime: number;
declare let tpMeasure: number;
declare let spMeasure: number;
declare let beatIndex: number;
declare let numerator: number;
declare let denominator: number;
declare let midiMeter: [number, number];
declare let beatStart: number;
declare let beatStartTime: number;
declare let tpBeat: number;
declare let spBeat: number;
declare let divIndex: number;
declare let divsPerBeat: number;
declare let divStart: number;
declare let divStartTime: number;
declare let tpDiv: number;
declare let spDiv: number;
declare let subdivIndex: number;
declare let subdivsPerDiv: number;
declare let subdivStart: number;
declare let subdivStartTime: number;
declare let tpSubdiv: number;
declare let spSubdiv: number;
declare let subsubdivIndex: number;
declare let subsubdivsPerSub: number;
declare let subsubdivStart: number;
declare let subsubdivStartTime: number;
declare let tpSubsubdiv: number;
declare let spSubsubdiv: number;
declare let sectionEnd: number;
declare let composer: any;
declare let PPQ: number;
declare let SILENT_OUTRO_SECONDS: number;
declare let LM: any;
declare const formatTime: (seconds: number) => string;
declare const allNotesOff: (tick: number) => any[];
declare const muteAll: (tick: number) => any[];
declare const rf: (min: number, max: number) => number;

/**
 * Logs timing markers with context awareness.
 * Writes to active buffer (c = c1 or c2) for proper file separation.
 */
export const logUnit = (type: string, ctxOrEnv?: ICompositionContext | Record<string, any>): void => {
  if (!ctxOrEnv) throw new Error('logUnit requires a context or env; global fallback removed');
  const source: any = ctxOrEnv as any;

  const get = (k: string, fallback: any) => {
    if (!source) return fallback;
    // Prefer explicit values from the source; treat undefined/null/NaN as absent so fallback applies
    if (Object.prototype.hasOwnProperty.call(source, k)) {
      const v = (source as any)[k];
      if (v === undefined || v === null) return fallback;
      if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
      return v;
    }
    if (source.state && Object.prototype.hasOwnProperty.call(source.state, k)) {
      const v = (source.state as any)[k];
      if (v === undefined || v === null) return fallback;
      if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
      return v;
    }
    return fallback;
  };

  let shouldLog = false;
  type = type.toLowerCase();

  const LOGv = get('LOG', 'none');
  if (LOGv === 'none') {
    shouldLog = false;
  } else if (LOGv === 'all') {
    shouldLog = true;
  } else {
    const logList = (String(LOGv).toLowerCase()).split(',').map((item: string) => item.trim());
    shouldLog = logList.length === 1 ? logList[0] === type : logList.includes(type);
  }

  // Debug: trace logUnit invocations during test runs only when DEBUG_LOGUNIT is enabled via DI (ctx or ctx.state)
  if (get('DEBUG_LOGUNIT', false)) {
    console.debug(`[logUnit] type=${type} LOG=${LOGv} shouldLog=${shouldLog} buffer=${(source && source.c && source.c.name) || (source && source.csvBuffer && source.csvBuffer.name) || 'unknown'}`);
  }
  if (!shouldLog) return;

  let unit = 0;
  let unitsPerParent = 0;
  let startTick = 0;
  let endTick = 0;
  let startTime = 0;
  let endTime = 0;
  let meterInfo = '';

  if (type === 'section') {
    unit = get('sectionIndex', 0) + 1;
    unitsPerParent = get('totalSections', 1);
    startTick = get('sectionStart', 0);
    const denomSection = get('tpSec', 1);
    const spSection = (Number.isFinite(denomSection) && denomSection !== 0) ? (get('tpSection', 0) / denomSection) : 0;
    endTick = startTick + get('tpSection', 0);
    startTime = get('sectionStartTime', 0);
    endTime = startTime + spSection;
  } else if (type === 'phrase') {
    unit = get('phraseIndex', 0) + 1;
    unitsPerParent = get('phrasesPerSection', 1);
    startTick = get('phraseStart', 0);
    endTick = startTick + get('tpPhrase', 0);
    startTime = get('phraseStartTime', 0);
    const denomPhrase = get('tpSec', 1);
    const spPhrase = (Number.isFinite(denomPhrase) && denomPhrase !== 0) ? (get('tpPhrase', 0) / denomPhrase) : 0;
    endTime = startTime + spPhrase;

    let composerDetails = get('composer', null) ? `${get('composer', null).constructor.name} ` : 'Unknown Composer ';
    const composer = get('composer', null);
    if (composer && composer.scale && composer.scale.name) {
      composerDetails += `${composer.root} ${composer.scale.name}`;
    } else if (composer && composer.progression) {
      const progressionSymbols = composer.progression.map((chord: any) => {
        return chord && chord.symbol ? chord.symbol : '[Unknown Symbol]';
      }).join(' ');
      composerDetails += progressionSymbols;
    } else if (composer && composer.mode && composer.mode.name) {
      composerDetails += `${composer.root} ${composer.mode.name}`;
    }

    const actualMeter: [number, number] = [get('numerator', 4), get('denominator', 4)];
    const midiMeterVal: [number, number] = get('midiMeter', [4, 4]);
    const safeTpSec = Number.isFinite(get('tpSec', 1)) ? get('tpSec', 1) : 1;
    // Debugging: when finite values are missing, emit a concise DI-controlled debug message
    if (get('DEBUG_LOGUNIT', false) && (!Number.isFinite(get('tpPhrase', 0)) || !Number.isFinite(get('tpSec', 1)))) {
      console.debug('[logUnit][DEBUG] Non-finite timing values detected', {
        tpPhrase: get('tpPhrase', 0),
        tpMeasure: get('tpMeasure', 0),
        tpSec: get('tpSec', 1),
        composer: get('composer', null) ? get('composer', null).constructor.name : null,
        unitType: 'phrase',
        ctxHasBuffer: !!(source && source.csvBuffer)
      });
    }
    meterInfo = midiMeterVal[1] === actualMeter[1]
      ? `Meter: ${actualMeter.join('/')} Composer: ${composerDetails} tpSec: ${safeTpSec}`
      : `Actual Meter: ${actualMeter.join('/')} MIDI Meter: ${midiMeterVal.join('/')} Composer: ${composerDetails} tpSec: ${safeTpSec}`;
  } else if (type === 'measure') {
    unit = get('measureIndex', 0) + 1;
    unitsPerParent = get('measuresPerPhrase', 1);
    startTick = get('measureStart', 0);
    endTick = startTick + get('tpMeasure', 0);
    startTime = get('measureStartTime', 0);
    endTime = get('measureStartTime', 0) + get('spMeasure', 0);

    let composerDetails = get('composer', null) ? `${get('composer', null).constructor.name} ` : 'Unknown Composer ';
    const composer = get('composer', null);
    if (composer && composer.scale && composer.scale.name) {
      composerDetails += `${composer.root} ${composer.scale.name}`;
    } else if (composer && composer.progression) {
      const progressionSymbols = composer.progression.map((chord: any) => {
        return chord && chord.symbol ? chord.symbol : '[Unknown Symbol]';
      }).join(' ');
      composerDetails += progressionSymbols;
    } else if (composer && composer.mode && composer.mode.name) {
      composerDetails += `${composer.root} ${composer.mode.name}`;
    }

    const actualMeter: [number, number] = [get('numerator', 4), get('denominator', 4)];
    const midiMeterVal: [number, number] = get('midiMeter', [4, 4]);
    const safeTpSec = Number.isFinite(get('tpSec', 1)) ? get('tpSec', 1) : 1;
    // Debugging: when finite values are missing, emit a concise DI-controlled debug message
    if (get('DEBUG_LOGUNIT', false) && !Number.isFinite(get('tpSec', 1))) {
      console.debug('[logUnit][DEBUG] Non-finite timing values detected', {
        tpMeasure: get('tpMeasure', 0),
        tpSec: get('tpSec', 1),
        composer: get('composer', null) ? get('composer', null).constructor.name : null,
        unitType: 'measure',
        ctxHasBuffer: !!(source && source.csvBuffer)
      });
    }
    meterInfo = midiMeterVal[1] === actualMeter[1]
      ? `Meter: ${actualMeter.join('/')} Composer: ${composerDetails} tpSec: ${safeTpSec}`
      : `Actual Meter: ${actualMeter.join('/')} MIDI Meter: ${midiMeterVal.join('/')} Composer: ${composerDetails} tpSec: ${safeTpSec}`;
  } else if (type === 'beat') {
    unit = get('beatIndex', 0) + 1;
    unitsPerParent = get('numerator', 4);
    startTick = get('beatStart', 0);
    endTick = startTick + get('tpBeat', 0);
    startTime = get('beatStartTime', 0);
    endTime = startTime + get('spBeat', 0);
  } else if (type === 'division') {
    unit = get('divIndex', 0) + 1;
    unitsPerParent = get('divsPerBeat', 1);
    startTick = get('divStart', 0);
    endTick = startTick + get('tpDiv', 0);
    startTime = get('divStartTime', 0);
    endTime = startTime + get('spDiv', 0);
  } else if (type === 'subdivision') {
    unit = get('subdivIndex', 0) + 1;
    unitsPerParent = get('subdivsPerDiv', 1);
    startTick = get('subdivStart', 0);
    endTick = startTick + get('tpSubdiv', 0);
    startTime = get('subdivStartTime', 0);
    endTime = startTime + get('spSubdiv', 0);
  } else if (type === 'subsubdivision') {
    unit = get('subsubdivIndex', 0) + 1;
    unitsPerParent = get('subsubdivsPerSub', 1);
    startTick = get('subsubdivStart', 0);
    endTick = startTick + get('tpSubsubdiv', 0);
    startTime = get('subsubdivStartTime', 0);
    endTime = startTime + get('spSubsubdiv', 0);
  }

  const fmt = get('formatTime', (s: number) => String(s));

  // Defensive time formatting: ensure finite numbers for start/end/duration to avoid 'NaN' in marker text
  const safeStartTime = Number.isFinite(startTime) ? startTime : 0;
  const safeEndTime = Number.isFinite(endTime) ? endTime : safeStartTime;
  const duration = Number.isFinite(safeEndTime - safeStartTime) ? (safeEndTime - safeStartTime) : 0;
  const safeEndTick = Number.isFinite(endTick) ? endTick : 0;

  const markerObj = {
    tick: Number.isFinite(startTick) ? startTick : 0,
    type: 'marker_t',
    vals: [`${type.charAt(0).toUpperCase() + type.slice(1)} ${unit}/${unitsPerParent} Length: ${fmt(duration)} (${fmt(safeStartTime)} - ${fmt(safeEndTime)}) endTick: ${safeEndTick} ${meterInfo ? meterInfo : ''}`]
  };
  // Determine the buffer to write into. Require explicit ctx.csvBuffer to enforce DI-only usage
  const bufferTarget = (source && source.csvBuffer);

  if (!bufferTarget) {
    throw new Error('logUnit: missing ctx.csvBuffer; logUnit is DI-only and requires ctx.csvBuffer to be set');
  }

  // Use DI-provided pushMultiple; require it to exist
  const pFn = requirePush((source as any) || undefined);
  if (typeof pFn !== 'function') {
    throw new Error('logUnit: pushMultiple service is required in DI container (registerWriterServices)');
  }

  // Call the DI push function with the single marker
  pFn(bufferTarget, markerObj);
};


/**
 * Outputs separate MIDI files for each layer with automatic synchronization.
 * Architecture:
 * - output1.csv/mid: Primary layer with its syncFactor
 * - output2.csv/mid: Poly layer with independent syncFactor
 * - output3.csv/mid+: Additional layers (when added)
 * - Phrase boundaries align perfectly in absolute time (seconds)
 * - Tick counts differ due to different tempo adjustments
 * - Automatically handles any number of layers
 */
export const grandFinale = (ctxOrEnv?: ICompositionContext | Record<string, any>): void => {
  if (!ctxOrEnv) throw new Error('grandFinale requires a context or env; global fallback removed');
  const env: any = ctxOrEnv as any;

  // fs module must be passed via env.fs or via container services
  const fsModule = env.fs || (env.container && env.container.get && env.container.get('fs')) || fs;

  // Collect layers from provided LM instance
  const layers = (env && env.LM && env.LM.layers && Object.keys(env.LM.layers).length)
    ? env.LM.layers
    : (env.layers || {});

  if (!layers || Object.keys(layers).length === 0) {
    throw new Error('grandFinale: No layer data provided in context/env');
  }

  const layerData = Object.entries(layers).map(([name, entry]: any) => ({
    name,
    buffer: entry.buffer || entry,
    state: entry.state || {}
  }));

  layerData.forEach(({ name, buffer, state }) => {
    const layerState: any = state || {};
    const bufferData: any = buffer;

    const sectionEnd = layerState.sectionEnd ?? layerState.sectionStart ?? 0;
    const tpSec = layerState.tpSec ?? env.tpSec ?? 1;

    // Cleanup hooks (must be provided via env)
    if (typeof env.allNotesOff === 'function') env.allNotesOff(sectionEnd + (env.PPQ || 480));
    if (typeof env.muteAll === 'function') env.muteAll(sectionEnd + (env.PPQ || 480) * 2);

    // Finalize buffer
    let finalBuffer = (Array.isArray(bufferData) ? bufferData : bufferData.rows)
      .filter((i: any) => i !== null)
      .map((i: any) => {
        // Normalize tick values defensively to avoid NaN/infinite values in output
        const rawTick = i.tick;
        let tickVal = Number.isFinite(rawTick) ? rawTick : Math.abs(rawTick || 0) * (env.rf ? env.rf(.1, .3) : rf(.1, .3));
        if (!Number.isFinite(tickVal) || tickVal < 0) tickVal = 0;
        // Sanitize string values inside vals to remove literal 'NaN' and 'undefined' tokens
        const sanitizeVal = (v: any) => {
          if (Number.isFinite(v)) return v;
          if (typeof v === 'number') return 0;
          if (typeof v === 'string') return v.replace(/\bNaN\b/gi, '0').replace(/\bundefined\b/gi, '');
          return v;
        };
        return {
          ...i,
          tick: tickVal,
          vals: Array.isArray(i.vals) ? i.vals.map(sanitizeVal) : (typeof i.vals === 'string' ? sanitizeVal(i.vals) : i.vals)
        };
      })
      .sort((a: any, b: any) => a.tick - b.tick);

    // Generate CSV
    let composition = `0,0,header,1,1,${env.PPQ || 480}\n1,0,start_track\n`;
    let finalTick = 0;

    finalBuffer.forEach((evt: any) => {
      if (Number.isFinite(evt.tick)) {
        const type = evt.type === 'on' ? 'note_on_c' : (evt.type || 'note_off_c');
        const vals = Array.isArray(evt.vals) ? evt.vals.join(',') : evt.vals;
        composition += `1,${evt.tick || 0},${type},${vals}\n`;
        finalTick = Math.max(finalTick, evt.tick || 0);
      }
    });

    composition += `1,${finalTick + ((env.SILENT_OUTRO_SECONDS ?? 1) * tpSec)},end_track`;

    // Determine output filename based on layer name
    let outputFilename: string;
    if (name === 'primary') {
      outputFilename = 'output/output1.csv';
    } else if (name === 'poly') {
      outputFilename = 'output/output2.csv';
    } else {
      outputFilename = `output/output${name.charAt(0).toUpperCase() + name.slice(1)}.csv`;
    }

    // Ensure output directory exists
    const outputDir = path.dirname(outputFilename);
    if (!fsModule.existsSync(outputDir)) {
      fsModule.mkdirSync(outputDir, { recursive: true });
    }

    // Sanitize text to avoid literal 'NaN' or 'undefined' in output CSV (defensive measure)
    // Aggressive sanitization: replace any literal 'NaN' with '0' and remove 'undefined' tokens
    composition = composition.split('NaN').join('0').split('undefined').join('');
    // Additional cleanup: fix malformed Length markers and missing tpSec values that can appear when upstream timing calculations fail
    composition = composition.replace(/Length:\s*(?:NaN|undefined)\s*\([^)]*\)/g, 'Length: 0 (0 - 0)');
    composition = composition.replace(/tpSec:\s*(?:NaN|undefined)/g, 'tpSec: 0');

    fsModule.writeFileSync(outputFilename, composition);
    console.log(`${outputFilename} created (${name} layer).`);
  });

  // Final sanitization pass: ensure no lingering 'NaN' or 'undefined' tokens in any CSV output files
  try {
    const outDir = path.resolve(process.cwd(), 'output');
    if (fsModule.existsSync(outDir)) {
      const files = fsModule.readdirSync(outDir).filter((f: string) => f.endsWith('.csv'));
      files.forEach((file: string) => {
        const pth = path.join(outDir, file);
        try {
          let txt = fsModule.readFileSync(pth, 'utf-8');
          const cleaned = txt.split('NaN').join('0').split('undefined').join('');
          if (cleaned !== txt) {
            fsModule.writeFileSync(pth, cleaned);
            console.log(`Sanitized ${pth}`);
          }
        } catch (e) {
          // ignore individual file errors
        }
      });
    }
  } catch (e) {
    // Ignore sanitization errors - best-effort only
  }
};

// Optional: Register writer services into a DIContainer for explicit DI usage
export function registerWriterServices(container: DIContainer): void {
  if (!container.has('pushMultiple')) {
    container.register('pushMultiple', () => pushMultiple, 'singleton');
  }
  if (!container.has('grandFinale')) {
    container.register('grandFinale', () => grandFinale, 'singleton');
  }
  // Provide fs to services so grandFinale can use DI instead of globals
  if (!container.has('fs')) {
    // Register Node's fs module via DI. Do NOT read from globalThis; enforce DI usage in tests.
    container.register('fs', () => fs, 'singleton');
  }

  // Make CSVBuffer available to DI consumers (constructor reference)
  if (!container.has('CSVBuffer')) {
    container.register('CSVBuffer', () => CSVBuffer, 'singleton');
  }
  // Debug: log registered services for tracing during migration
  // console.debug('registerWriterServices: services now =', container.getServiceKeys());
}

/**
 * Returns the registered pushMultiple function from the provided context or throws.
 * Enforces DI-first usage: no fallbacks to globals will be performed.
 */
export function requirePush(ctx?: ICompositionContext) {
  const msg = 'Missing writer service "pushMultiple" in DI container. Call registerWriterServices(container) and ensure service is available on ctx.container.';
  try {
    if (ctx && (ctx as any).container && (ctx as any).container.has && (ctx as any).container.has('pushMultiple')) {
      return (ctx as any).container.get('pushMultiple');
    }
  } catch (e) {
    // ignore and throw below
  }
  // no fallback to globals — enforce DI
  console.error(msg);
  throw new Error(msg);
}

// NOTE: Global exposure layer was removed in favor of DI-only usage.
// Call `registerWriterServices(container)` in test setup and use the produced
// services via `ctx.services.get('pushMultiple')` or `getWriterServices(ctx)`.
// The legacy `p` global is deprecated and should not be used.
