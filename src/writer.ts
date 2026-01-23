// writer.ts - MIDI output and file generation with CSV buffer management.
/* eslint-disable @typescript-eslint/no-unused-vars */
// minimalist comments, details at: writer.md

import * as fs from 'fs';
import * as path from 'path';
import { DIContainer } from './DIContainer.js';
import { ICompositionContext } from './CompositionContext.js';
import { getPolychronContext } from './PolychronInit.js';

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
    // Unit-label (7th-column) feature is disabled — do not set `unitLabel` on buffers.

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
  const sanitizeTick = (tick: any) => {
    let t = Number(tick);
    if (!Number.isFinite(t)) t = Math.abs(tick) || 0;
    t = Math.round(t);
    if (t < 0) t = 0;
    return t;
  };

  const label = buffer && (buffer as any).unitLabel;

  const sanitized = items.map(it => {
    // Only treat objects that look like MIDI events (have type/tick/vals); otherwise preserve as-is
    if (!it || typeof it !== 'object' || (!('type' in it) && !('tick' in it) && !('vals' in it))) {
      return it;
    }

    // Treat as MIDIEvent-like object
    // Compute sanitized numeric tick
    const sanitizedTick = sanitizeTick((it as any).tick);
    // If the buffer has an active unitTiming with a unitHash, append it into the tick field as `tick|unitHash`
    let tickWithUnit: any = sanitizedTick;
    try {
      const unitHash = (buffer && (buffer as any).unitTiming && (buffer as any).unitTiming.unitHash) ? (buffer as any).unitTiming.unitHash : null;
      // If no immediate unitTiming present, fall back to sustained currentUnitHashes recorded by setUnitTiming
      const fallback = (buffer && (buffer as any).currentUnitHashes) ? (buffer as any).currentUnitHashes : {};
      const type = (it && (it as any).type) ? String((it as any).type).toLowerCase() : '';
      const isMarkerLike = type === 'marker_t' || type === 'unit_handoff' || type.startsWith('marker');
      const chosen = unitHash || fallback.measure || fallback.beat || fallback.division || fallback.subdivision || fallback.phrase || null;
      if (chosen && !isMarkerLike) {
        tickWithUnit = `${sanitizedTick}|${chosen}`;
      }
    } catch (_e) {}

    const copy: any = { ...it, tick: tickWithUnit };
    if (!copy.vals) copy.vals = [] as any;
    if (!Array.isArray(copy.vals)) copy.vals = [copy.vals];

    // Debug: if a NOTE ON at tick 0 is being written, emit minimal provenance log without mutating `vals`
    try {
      if (copy.tick === 0 && String(copy.type).toLowerCase().includes('on')) {
        try {
          const poly = getPolychronContext();
          const testLogging = (poly && poly.test && poly.test.enableLogging) || (globalThis as any).__POLYCHRON_TEST__?.enableLogging || false;
          if (testLogging) {
            console.error(`[pushMultiple] provenance: tick=0 type=${copy.type} buffer=${(buffer && (buffer as any).name) || (Array.isArray(buffer) ? 'array' : 'unknown')}`);
          }
        } catch (_ee) {}
      }
    } catch (_e) {}

    // Unit-label feature disabled: do not annotate event `vals` with unit labels.
    return copy;
  });

  if (buffer instanceof CSVBuffer) {
    buffer.push(...sanitized);
  } else if (Array.isArray(buffer)) {
    buffer.push(...sanitized);
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

  // Aggregate unit metadata across layers to aid CSV treewalking and validation
  const allUnits: any[] = [];

  layerData.forEach(({ name, buffer, state }, layerIndex) => {
    const layerState: any = state || {};
    const bufferData: any = buffer;

    // Determine track number and output filename for this layer
    const trackNum = (layerIndex || 0) + 1;
    const outputFilename = (name === 'primary') ? 'output/output1.csv' : (name === 'poly') ? 'output/output2.csv' : `output/output${name.charAt(0).toUpperCase() + name.slice(1)}.csv`;

    const sectionEnd = layerState.sectionEnd ?? layerState.sectionStart ?? 0;
    const tpSec = layerState.tpSec ?? env.tpSec ?? 1;

    // Cleanup hooks (must be provided via env)
    if (typeof env.allNotesOff === 'function') env.allNotesOff(sectionEnd + (env.PPQ || 480));
    if (typeof env.muteAll === 'function') env.muteAll(sectionEnd + (env.PPQ || 480) * 2);

    // Finalize buffer
    // Collect unit markers for this layer so we can write a structured JSON manifest
    const unitsForLayer: any[] = [];
    let finalBuffer = (Array.isArray(bufferData) ? bufferData : bufferData.rows)
      .filter((i: any) => i !== null)
      // Filter out internal-only events that are not valid CSV/MIDI events
      .filter((i: any) => !(i && i._internal))
      .map((i: any) => {
        // Normalize and parse tick values defensively to support `tick|unitHash` strings
        const rawTick = i.tick;
        let tickNumPart: number | null = null;
        let unitHashPart: string | null = null;

        if (typeof rawTick === 'string' && rawTick.includes('|')) {
          const parts = String(rawTick).split('|');
          tickNumPart = Number(parts[0]);
          unitHashPart = parts[1] || null;
        } else if (Number.isFinite(rawTick)) {
          tickNumPart = Number(rawTick);
        } else if (typeof rawTick === 'string') {
          tickNumPart = Number(rawTick);
        }

        let tickVal = Number.isFinite(tickNumPart as any) ? (tickNumPart as number) : Math.abs(rawTick || 0) * (env.rf ? env.rf(.1, .3) : rf(.1, .3));
        if (!Number.isFinite(tickVal) || tickVal < 0) tickVal = 0;
        tickVal = Math.round(tickVal);

        // Re-encode tick with unitHash if present so CSV contains `tick|unitHash`
        const tickOut = unitHashPart ? `${tickVal}|${unitHashPart}` : tickVal;

        // Sanitize string values inside vals to remove literal 'NaN' and 'undefined' tokens
        const sanitizeVal = (v: any) => {
          if (Number.isFinite(v)) return v;
          if (typeof v === 'number') return 0;
          if (typeof v === 'string') return v.replace(/\bNaN\b/gi, '0').replace(/\bundefined\b/gi, '');
          return v;
        };

        // If this is a unit marker emitted by setUnitTiming, parse and capture the unit metadata
        try {
          if (i && i.type === 'marker_t' && Array.isArray(i.vals)) {
            const vh = (i.vals.find((v: any) => String(v).startsWith('unitHash:')) || '') as string;
            const vt = (i.vals.find((v: any) => String(v).startsWith('unitType:')) || '') as string;
            const vs = (i.vals.find((v: any) => String(v).startsWith('start:')) || '') as string;
            const ve = (i.vals.find((v: any) => String(v).startsWith('end:')) || '') as string;
            const vsec = (i.vals.find((v: any) => String(v).startsWith('section:')) || '') as string;
            const vphr = (i.vals.find((v: any) => String(v).startsWith('phrase:')) || '') as string;
            const vmea = (i.vals.find((v: any) => String(v).startsWith('measure:')) || '') as string;
            const uhash = vh ? String(vh).split(':')[1] : null;
            const utype = vt ? String(vt).split(':')[1] : null;
            const ustart = vs ? Number(String(vs).split(':')[1]) : undefined;
            const uend = ve ? Number(String(ve).split(':')[1]) : undefined;
            let usec = vsec ? Number(String(vsec).split(':')[1]) : undefined;
            const uphr = vphr ? Number(String(vphr).split(':')[1]) : undefined;
            const umea = vmea ? Number(String(vmea).split(':')[1]) : undefined;
            if (uhash) {
              // If marker omitted section info, attempt to resolve it from the timing tree
              if (!Number.isFinite(usec) && env && env.state && env.state.timingTree && env.state.timingTree[name]) {
                const findNode = (node: any): any => {
                  if (!node || typeof node !== 'object') return null;
                  if (node.unitHash === uhash) return node;
                  if (node.children) {
                    for (const k of Object.keys(node.children)) {
                      const r = findNode(node.children[k]);
                      if (r) return r;
                    }
                  }
                  for (const k of Object.keys(node)) {
                    if (/^\d+$/.test(k) && typeof node[k] === 'object') {
                      const r = findNode(node[k]);
                      if (r) return r;
                    }
                  }
                  return null;
                };
                try {
                  const foundNode = findNode(env.state.timingTree[name]);
                  if (foundNode && Number.isFinite(Number(foundNode.sectionIndex))) {
                    usec = Number(foundNode.sectionIndex);
                  }
                } catch (_e) {}
              }

              const unitRec: any = { unitHash: uhash, unitType: utype, layer: name, startTick: ustart, endTick: uend };
              if (Number.isFinite(usec)) unitRec.sectionIndex = usec;
              if (Number.isFinite(uphr)) unitRec.phraseIndex = uphr;
              if (Number.isFinite(umea)) unitRec.measureIndex = umea;
              unitsForLayer.push(unitRec);
            }
          }
        } catch (_e) {}

        // Backfill unitHash for events that did not receive `tick|unitHash` at push time by finding the unit that contains the event tick
        try {
          if (!unitHashPart && typeof tickVal === 'number') {
            const found = unitsForLayer.find((u: any) => {
              const s = Number(u.startTick || 0);
              const e = Number(u.endTick || 0);
              return Number.isFinite(s) && Number.isFinite(e) && (tickVal >= s && tickVal < e);
            });
            if (found) {
              unitHashPart = found.unitHash;
            }
          }
        } catch (_e) {}

        return {
          ...i,
          tick: tickOut,
          _tickSortKey: tickVal,
          vals: Array.isArray(i.vals) ? i.vals.map(sanitizeVal) : (typeof i.vals === 'string' ? sanitizeVal(i.vals) : i.vals)
        };
      })
      .sort((a: any, b: any) => (a._tickSortKey || 0) - (b._tickSortKey || 0));

    // Compute per-section offsets so events emitted with section-local ticks get placed on a
    // global absolute timeline when multiple sections are composed into the same output.
    try {
      // Determine maximum endTick per section from units discovered so far
      const sectionMaxEnd: Record<number, number> = {};
      for (const u of unitsForLayer) {
        const si = (u && u.sectionIndex !== undefined && Number.isFinite(Number(u.sectionIndex))) ? Number(u.sectionIndex) : 0;
        const e = Number(u.endTick || 0);
        sectionMaxEnd[si] = Math.max(sectionMaxEnd[si] || 0, Number.isFinite(e) ? e : 0);
      }

      // Build cumulative offsets in section order
      const sectionIndices = Object.keys(sectionMaxEnd).map(s => Number(s)).sort((a, b) => a - b);
      const sectionOffsets: Record<number, number> = {};
      let cumOffset = 0;
      for (const idx of sectionIndices) {
        sectionOffsets[idx] = cumOffset;
        cumOffset += sectionMaxEnd[idx] || 0;
      }

      // Apply offsets to discovered units so units manifest records absolute ticks
      for (const u of unitsForLayer) {
        if (u && u.sectionIndex !== undefined && Number.isFinite(Number(u.sectionIndex))) {
          const si = Number(u.sectionIndex);
          const off = sectionOffsets[si] || 0;
          u.startTick = Number(u.startTick || 0) + off;
          u.endTick = Number(u.endTick || 0) + off;
        }
      }

      // Build quick lookup by unitHash for fast per-event offset resolution
      const unitByHash: Record<string, any> = {};
      for (const u of unitsForLayer) {
        if (u && u.unitHash) unitByHash[String(u.unitHash)] = u;
      }

      // Adjust finalBuffer event ticks to global timeline using unitHash or unit containment
      finalBuffer = finalBuffer.map((evt: any) => {
        try {
          const rawTick = evt && evt.tick;
          let tickVal = Number(evt._tickSortKey || 0) || 0;
          let unitHashPart: string | null = null;

          // If tick was emitted with unitHash (tick|unitHash), use it to find offset
          if (typeof rawTick === 'string' && rawTick.includes('|')) {
            unitHashPart = String(rawTick).split('|')[1] || null;
          }

          let offset = 0;
          if (unitHashPart && unitByHash[unitHashPart] && Number.isFinite(Number(unitByHash[unitHashPart].sectionIndex))) {
            offset = Number(unitByHash[unitHashPart].sectionIndex) >= 0 ? (Number(sectionOffsets[Number(unitByHash[unitHashPart].sectionIndex)] || 0)) : 0;
          } else {
            // Fallback: find the unit containing this tick in current discovered units
            const found = unitsForLayer.find((u: any) => {
              const s = Number(u.startTick || 0);
              const e = Number(u.endTick || 0);
              return Number.isFinite(s) && Number.isFinite(e) && (tickVal >= s && tickVal < e);
            });
            if (found) {
              offset = Number(sectionOffsets[Number(found.sectionIndex)] || 0);
              unitHashPart = unitHashPart || found.unitHash;
            }
          }

          if (offset) {
            tickVal = Math.round(tickVal + offset);
            evt._tickSortKey = tickVal;
            evt.tick = unitHashPart ? `${tickVal}|${unitHashPart}` : `${tickVal}`;
          }
        } catch (_e) {
          // non-fatal
        }
        return evt;
      });
    } catch (_e) {
      // best-effort only: do not fail composition on diagnostic re-alignment
    }

    // DI debug: count note-like events so we can detect why CSV appears silent
    try {
      const noteLike = finalBuffer.filter((evt: any) => evt && (evt.type === 'on' || String(evt.type).toLowerCase().includes('note_on')));
      if (typeof console !== 'undefined' && console.error) {
        console.error(`[grandFinale] DEBUG layer=${name} finalBuffer.total=${finalBuffer.length} noteLike=${noteLike.length}`);
        if (noteLike.length > 0) {
          console.error('[grandFinale] DEBUG sample noteLike events:\n', JSON.stringify(noteLike.slice(0, 10), null, 2).slice(0, 2000));
        }
      }
    } catch (_e) {}

    // Diagnostic: compose sample CSV lines as they would be emitted and log them for inspection
    try {
      const sampleLimit = 20;
      const composed = finalBuffer.slice(0, sampleLimit).map((evt: any) => {
        const t = evt && evt.type ? evt.type : '';
        const csvType = (t === 'on') ? 'note_on_c' : t;
        const vals = Array.isArray(evt.vals) ? evt.vals.join(',') : (evt.vals ?? '');
        return `${trackNum},${evt.tick},${csvType}${vals ? ',' + vals : ''}`;
      });
      const noteLikeCount = finalBuffer.filter((evt: any) => evt && (evt.type === 'on' || (evt.type && String(evt.type).toLowerCase().includes('note_on')))).length;
      console.error(`[grandFinale][DIAG] layer=${name} composed sample lines (first ${composed.length}), noteLike=${noteLikeCount} totalRows=${finalBuffer.length}:\n${composed.join('\n')}`);
    } catch (_e) {}

    // Ensure CSV files include note events: convert `on` events into `note_on_c` and write per-layer CSV here
    try {
      const PPQv = env.PPQ || 480;
      let comp = `0,0,header,1,1,${PPQv}\n${trackNum},0,start_track\n`;
      for (const evt of finalBuffer) {
        const rawType = evt && evt.type ? String(evt.type) : '';
        let outType = rawType === 'on' ? 'note_on_c' : (rawType || (Array.isArray(evt.vals) && evt.vals.length === 2 ? 'note_off_c' : rawType));
        const valsArr = Array.isArray(evt.vals) ? evt.vals.map((v: any) => {
          if (typeof v === 'number') {
            if (!Number.isFinite(v)) return '0';
            return String(Math.round(v));
          }
          return String(v).replace(/\n/g, ' ');
        }) : [];
        // Ensure Time column is numeric for csvmidi: if tick includes unitHash (tick|unitHash), split it out
        let tickField: any = evt.tick;
        let unitHashCol = '';
        try {
          if (typeof tickField === 'string' && tickField.includes('|')) {
            const parts = String(tickField).split('|');
            tickField = Number(parts[0]);
            const u = parts[1] || '';
            if (u) unitHashCol = `,${u}`;
          }
        } catch (_e) {}
        // Only append unitHash for event types that are safe (won't be parsed as required numeric fields)
        const safeTypes = new Set(['note_on_c','note_off_c','note_on','note_off','control_c','program_c','pitch_bend_c','aftertouch_c']);
        const appendUnitHash = unitHashCol && safeTypes.has(String(outType).toLowerCase());
        // Map internal-only types to safe CSV-friendly types
        if (String(outType).toLowerCase() === 'unit_handoff') {
          const u = unitHashCol ? unitHashCol.slice(1) : '';
          comp += `${trackNum},${tickField},marker_t,unit_handoff${u ? ',' + u : ''}\n`;
        } else {
          comp += `${trackNum},${tickField},${outType}${valsArr.length ? ',' + valsArr.join(',') : ''}${appendUnitHash ? unitHashCol : ''}\n`;
        }
      }
      const lastTick = finalBuffer.length ? (finalBuffer[finalBuffer.length - 1]._tickSortKey || 0) : 0;
      const finalTick = lastTick + (env.PPQ || 480);
      comp += `${trackNum},${finalTick},end_track\n`;
      try { fsModule.mkdirSync(path.dirname(outputFilename), { recursive: true }); } catch (_e) {}
      fsModule.writeFileSync(outputFilename, comp);
      console.log(`Wrote CSV for ${name} -> ${outputFilename} (rows=${finalBuffer.length})`);
    } catch (_e) {
      console.error('[grandFinale] failed to write CSV for layer', name, _e);
    }
    try {
      if ((!unitsForLayer || unitsForLayer.length === 0) && env && env.state && env.state.timingTree && env.state.timingTree[name]) {
          const walk = (node: any, pathParts: string[] = []) => {
            const found: any[] = [];
            if (!node || typeof node !== 'object') return found;
            // Derive indices from pathParts like ['section','0','phrase','1','measure','2']
            const idx = (key: string) => {
              const i = pathParts.indexOf(key);
              if (i >= 0 && i + 1 < pathParts.length) return Number(pathParts[i + 1]);
              return undefined;
            };
            // Prefer explicit indices stored on the timing node (setUnitTiming writes these)
            const sectionIndex = (node && Number.isFinite(Number(node.sectionIndex))) ? Number(node.sectionIndex) : idx('section');
            const phraseIndex = (node && Number.isFinite(Number(node.phraseIndex))) ? Number(node.phraseIndex) : idx('phrase');
            const measureIndex = (node && Number.isFinite(Number(node.measureIndex))) ? Number(node.measureIndex) : idx('measure');
            if (node.unitHash) {
              found.push({ unitHash: node.unitHash, layer: name, startTick: node.start ?? node.measureStart ?? 0, endTick: node.end ?? (Number(node.start ?? 0) + Number(node.tpMeasure ?? 0)), sectionIndex, phraseIndex, measureIndex });
            }
            if (node.children) {
              for (const k of Object.keys(node.children)) {
                found.push(...walk(node.children[k], pathParts.concat(k)));
              }
            }
            // Also support cases where a node's children are stored directly under numeric keys
            for (const k of Object.keys(node)) {
              if (/^\d+$/.test(k) && typeof (node as any)[k] === 'object') {
                found.push(...walk((node as any)[k], pathParts.concat(k)));
              }
            }
            return found;
          };
          const extracted = walk(env.state.timingTree[name]);
          if (extracted && extracted.length > 0) {
            // Ensure derived unitType is set when available
            unitsForLayer.push(...extracted.map(u => ({ ...u, unitType: u.unitType || (u.measureIndex !== undefined ? 'measure' : (u.phraseIndex !== undefined ? 'phrase' : (u.sectionIndex !== undefined ? 'section' : undefined))) })));
          }
      }
    } catch (_e) {}

    // Append units discovered in this layer to the global units list
    try {
      if (unitsForLayer && unitsForLayer.length > 0) {
        // Compute startTime/endTime for each unit when possible using layerState.tpSec or fallback
        const tpSec = layerState.tpSec || env.tpSec || 480;
        const enriched = unitsForLayer.map(u => ({
          ...u,
          file: outputFilename,
          startTime: (u.startTick !== undefined && Number.isFinite(tpSec) && tpSec !== 0) ? Number((u.startTick / tpSec).toFixed(6)) : (u.startTime ?? undefined),
          endTime: (u.endTick !== undefined && Number.isFinite(tpSec) && tpSec !== 0) ? Number((u.endTick / tpSec).toFixed(6)) : (u.endTime ?? undefined)
        }));
        allUnits.push(...enriched);
      }
    } catch (_e) {}
  });

  // Write a structured units manifest to help the treewalker quickly resolve unit time ranges
  try {
    const unitsManifest = {
      generatedAt: (new Date()).toISOString(),
      layers: layerData.map(l => l.name),
      units: allUnits
    };
    const unitsPath = 'output/units.json';
    fsModule.writeFileSync(unitsPath, JSON.stringify(unitsManifest, null, 2));
    console.log(`Wrote units manifest to ${unitsPath} (${allUnits.length} units).`);
  } catch (_e) {}

  // Diagnostic: report number of NOTE pushes observed during run (global counter incremented in PlayNotes.pushEvent)
  try {
    const pushed = (globalThis as any).__PUSH_NOTE_COUNT || 0;
    console.error(`[grandFinale] DEBUG total note pushes observed (global counter) = ${pushed}`);
  } catch (_e) {}
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

  // DIAGNOSTIC: after sanitization, scan written CSV files and report presence (or absence) of note_on rows
  try {
    const outDir = path.resolve(process.cwd(), 'output');
    if (fsModule.existsSync(outDir)) {
      const files = fsModule.readdirSync(outDir).filter((f: string) => f.endsWith('.csv'));
      files.forEach((file: string) => {
        const pth = path.join(outDir, file);
        try {
          const txt = fsModule.readFileSync(pth, 'utf-8');
          const lines = txt.split('\n').filter((l: string) => l && l.trim().length > 0);
          const noteLines = lines.filter((l: string) => l.includes(',note_on_c,') || l.includes(',note_on,') || l.includes(',on,'));
          console.error(`[grandFinale][DIAG] file=${pth} totalLines=${lines.length} note-like lines=${noteLines.length}`);
          if (noteLines.length > 0) {
            console.error('[grandFinale][DIAG] sample note lines:\n', noteLines.slice(0, 10).join('\n'));
          } else {
            console.error('[grandFinale][DIAG] sample file head:\n', lines.slice(0, 20).join('\n'));
          }
        } catch (_e) {
          // ignore per-file read errors for diagnostics
        }
      });
    }
  } catch (_e) {}

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
    // Register Node's fs module via DI. Do NOT read from runtime globals; enforce DI usage in tests.
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
