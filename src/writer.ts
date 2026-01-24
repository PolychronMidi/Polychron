// writer.ts - MIDI output and file generation with CSV buffer management.
/* eslint-disable @typescript-eslint/no-unused-vars */
// minimalist comments, details at: writer.md

import * as fs from 'fs';
import * as path from 'path';
import { DIContainer } from './DIContainer.js';
import { ICompositionContext } from './CompositionContext.js';
import { getPolychronContext } from './PolychronInit.js';
import { findUnitAtTick } from './TimingTree.js';

const _shouldTrace_writer = (() => { try { const poly = getPolychronContext(); return !!(poly && poly.test && (poly.test._traceMode === 'full' || poly.test._traceMode === 'deep')); } catch (_e) { return false; } })();

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
    // Track currently active notes for this buffer to prevent emitting unmatched 'off' events.
    (this as any)._activeNotes = new Set<string>();

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

  // First, map incoming items into sanitized copies (no filtering yet)
  const sanitized = items.map(it => {
    // Only treat objects that look like MIDI events (have type/tick/vals); otherwise preserve as-is
    if (!it || typeof it !== 'object' || (!('type' in it) && !('tick' in it) && !('vals' in it))) {
      return it;
    }

    // Treat as MIDIEvent-like object
    // Compute sanitized numeric tick
    let sanitizedTick = sanitizeTick((it as any).tick);
    // Precompute event type and marker-ness so checks below can use them outside the try block
    const type = (it && (it as any).type) ? String((it as any).type).toLowerCase() : '';
    const isMarkerLike = type === 'marker_t' || type === 'unit_handoff' || type.startsWith('marker');

    // Nudge NOTE ON events away from absolute tick 0 only when writing into an active buffer with unitTiming
    // This preserves explicit test pushes and manual buffer writes while preventing pathological stacks during composition.
    if (!isMarkerLike && typeof sanitizedTick === 'number' && sanitizedTick === 0 && type.includes('on') && buffer && (buffer as any).unitTiming) {
      sanitizedTick = 1;
    }

    // If the buffer has an active unitTiming with a unitHash, append it into the tick field as `tick|unitHash`
    let tickWithUnit: any = sanitizedTick;
    try {
      const unitHash = (buffer && (buffer as any).unitTiming && (buffer as any).unitTiming.unitHash) ? (buffer as any).unitTiming.unitHash : null;
      // If no immediate unitTiming present, fall back to sustained currentUnitHashes recorded by setUnitTiming
      const fallback = (buffer && (buffer as any).currentUnitHashes) ? (buffer as any).currentUnitHashes : {};
      let chosen = unitHash || fallback.measure || fallback.beat || fallback.division || fallback.subdivision || fallback.phrase || (buffer && (buffer as any).lastAssignedUnitHash) || null;
      // Additional fallback: try to infer unitHash by consulting the timing tree for the layer at this tick.
      // If a direct lookup fails, search within a small radius to tolerate off-by-one/rounding differences.
      try {
        if (!chosen) {
          const poly = getPolychronContext();
          const tickNum = Number(sanitizedTick);
          if (poly && poly.state && poly.state.timingTree && typeof tickNum === 'number') {
            try {
              // Try exact tick first
              let node = findUnitAtTick(poly.state.timingTree, (buffer && (buffer as any).name) || 'primary', tickNum);
              // If not found, probe a small window (+/- 5 ticks) to be resilient to small timing shifts
              if (!node) {
                for (let d = 1; d <= 5 && !node; d++) {
                  node = findUnitAtTick(poly.state.timingTree, (buffer && (buffer as any).name) || 'primary', tickNum - d) || findUnitAtTick(poly.state.timingTree, (buffer && (buffer as any).name) || 'primary', tickNum + d);
                }
              }
              if (node && node.unitHash) {
                chosen = node.unitHash;
                // Persist resilient fallback onto the buffer so subsequent events pick it up immediately
                try {
                  // Only attach these helper fields to CSVBuffer instances to avoid mutating plain arrays
                  if (buffer && (buffer as any) instanceof CSVBuffer) {
                    (buffer as any).lastAssignedUnitHash = chosen;
                    (buffer as any).currentUnitHashes = (buffer as any).currentUnitHashes || {};
                    // Best-effort: store under 'inferred' key to avoid overwriting explicit types
                    (buffer as any).currentUnitHashes.inferred = chosen;
                  }
                } catch (_e) {}
                // Trace (sparse): record that we inferred a unitHash as a quick diagnostic when tracing is enabled
                try { import('./trace.js').then(({ traceWarn }) => traceWarn('anomaly', '[writer][INFO] inferred unitHash from TimingTree', { buffer: (buffer && (buffer as any).name) || 'unknown', tick: tickNum, unitHash: chosen })).catch(() => {}); } catch (_e) {}
              }
            } catch (_e) {}
          }
        }
      } catch (_e) {}
      if (chosen && !isMarkerLike) {
        // Annotate tick with the resolved unitHash for downstream consumers and tests.
        try { tickWithUnit = `${sanitizedTick}|${chosen}`; } catch (_e) {}
      }
    } catch (_e) {}

    const copy: any = { ...it, tick: tickWithUnit };
    return copy;
  });

  // Pre-scan batch for 'on' events so off events that have a prior on in the same batch (tick <= offTick) are recognized even if ordered earlier
  const batchOnMap = new Map<string, number[]>();
  try {
    for (const s of sanitized) {
      if (!s || typeof s !== 'object') continue;
      const typ = String(s.type || '').toLowerCase();
      const isOnLike = (typ.includes('on') || (Array.isArray(s.vals) && s.vals.length >= 3));
      if (isOnLike) {
        const ch = Number(s.vals && s.vals[0]);
        const note = Number(s.vals && s.vals[1]);
        const t = Number.isFinite(Number(s.tick)) ? Number(s.tick) : 0;
        if (Number.isFinite(ch) && Number.isFinite(note)) {
          const key = `${ch}:${note}`;
          const arr = batchOnMap.get(key) || [];
          arr.push(Math.round(t));
          batchOnMap.set(key, arr);
        }
      }
    }
  } catch (_e) {}
    // Process sanitized copies in tick-sorted order and apply push-time enforcement (prevent creating unmatched offs)
    const sanitizedSorted = sanitized.slice().sort((a: any, b: any) => {
      const ta = Number(a && a.tick) || 0;
      const tb = Number(b && b.tick) || 0;
      if (ta !== tb) return ta - tb;
      const aOn = String((a && a.type) || '').toLowerCase().includes('on') || (Array.isArray(a && a.vals) && a.vals.length >= 3);
      const bOn = String((b && b.type) || '').toLowerCase().includes('on') || (Array.isArray(b && b.vals) && b.vals.length >= 3);
      if (aOn && !bOn) return -1;
      if (!aOn && bOn) return 1;
      return 0;
    });

    const processed: any[] = [];

    // Ensure an activeNotes set exists for CSVBuffer instances; for plain arrays use a local transient set
    let active: Set<string> = new Set();
    try {
      if (buffer && (buffer as any) instanceof CSVBuffer) {
        if (!(buffer as any)._activeNotes) (buffer as any)._activeNotes = new Set();
        active = (buffer as any)._activeNotes;
      }
    } catch (_e) { active = new Set(); }

    for (const copy of sanitizedSorted) {
      // Preserve non-MIDI-like objects as-is to avoid mutating user objects (tests rely on this)
      if (!copy || typeof copy !== 'object' || (!('type' in copy) && !('tick' in copy) && !('vals' in copy))) { processed.push(copy); continue; }
      const sanitizedTick = Number.isFinite(Number(copy.tick)) ? Math.round(Number(copy.tick)) : 0;
      const typ = String(copy.type || '').toLowerCase();
      const isMarkerLike = typ === 'marker_t' || typ === 'unit_handoff' || typ.startsWith('marker');

      // Test-only guard: throw if a non-marker event is written without a `unitHash` when the test harness requests strictness
      const failOnMissing = (() => { try { const poly = getPolychronContext(); return !!(poly && poly.test && poly.test.failOnMissingUnitHash); } catch (_e) { return false; } })();
      if (!isMarkerLike) {
        const hasUnitInTick = (typeof copy.tick === 'string' && String(copy.tick).includes('|'));
        if (!hasUnitInTick && failOnMissing) {
          const bname = (buffer && (buffer as any).name) || (Array.isArray(buffer) ? 'array' : 'unknown');
          throw new Error(`[pushMultiple][FAIL_ON_MISSING_UNITHASH] Writing event without unitHash: type=${String(copy.type)} tick=${sanitizedTick} buffer=${bname}`);
        }

        // Out-of-range guard: check event tick falls within buffer.unitTiming start/end when available
        const bufTiming = buffer && (buffer as any).unitTiming ? (buffer as any).unitTiming : null;
        const startTickNum = bufTiming && Number.isFinite(Number(bufTiming.startTick)) ? Math.round(Number(bufTiming.startTick)) : null;
        const endTickNum = bufTiming && Number.isFinite(Number(bufTiming.endTick)) ? Math.round(Number(bufTiming.endTick)) : null;
        if (startTickNum !== null && endTickNum !== null) {
          if (sanitizedTick < startTickNum || sanitizedTick > endTickNum) {
            const failOnOutOfRange = (() => { try { const poly = getPolychronContext(); return !!(poly && poly.test && poly.test.failOnEventOutOfRange); } catch (_e) { return false; } })();
            const bname = (buffer && (buffer as any).name) || (Array.isArray(buffer) ? 'array' : 'unknown');
            if (failOnOutOfRange) {
              throw new Error(`[pushMultiple][FAIL_ON_EVENT_OUT_OF_RANGE] Event tick ${sanitizedTick} outside unit bounds [${startTickNum}, ${endTickNum}] type=${String(copy.type)} buffer=${bname}`);
            } else {
              try { if (_shouldTrace_writer) console.error(`[pushMultiple][WARN] Event tick ${sanitizedTick} outside unit bounds [${startTickNum}, ${endTickNum}] type=${String(copy.type)} buffer=${bname}`); } catch (_e) {}
            }
          }
        }
      }

      if (!copy.vals) copy.vals = [] as any;
      if (!Array.isArray(copy.vals)) copy.vals = [copy.vals];

      // Debug provenance logging for tick=0 on 'on' events
      try {
        if (copy.tick === 0 && String(copy.type).toLowerCase().includes('on')) {
          try {
            const poly = getPolychronContext();
            const testLogging = (poly && poly.test && poly.test.enableLogging) || (globalThis as any).__POLYCHRON_TEST__?.enableLogging || false;
            if (testLogging) console.error(`[pushMultiple] provenance: tick=0 type=${copy.type} buffer=${(buffer && (buffer as any).name) || (Array.isArray(buffer) ? 'array' : 'unknown')}`);
          } catch (_ee) {}
        }
      } catch (_e) {}

      const isOnLike = (!isMarkerLike && (String(copy.type || '').toLowerCase().includes('on') || (Array.isArray(copy.vals) && copy.vals.length >= 3)));
      // Off detection: explicit 'off' types, or implicit 2-val off events. If 'type' exists and clearly indicates non-note activity (program/control) avoid classifying as off.
      const rawType = String(copy.type || '').toLowerCase();
      const isOffLike = (!isMarkerLike && (rawType.includes('off') || (Array.isArray(copy.vals) && copy.vals.length === 2 && (!rawType || rawType.includes('note') || rawType.includes('note_off')))));

      if (isOnLike) {
        const ch = Number(copy.vals && copy.vals[0]);
        const note = Number(copy.vals && copy.vals[1]);
        if (Number.isFinite(ch) && Number.isFinite(note)) {
          try { active.add(`${ch}:${note}`); } catch (_e) {}
        }
        processed.push(copy);
        continue;
      }

      if (isOffLike) {
        const ch = Number(copy.vals && copy.vals[0]);
        const note = Number(copy.vals && copy.vals[1]);
        const key = `${ch}:${note}`;
        if (Number.isFinite(ch) && Number.isFinite(note)) {
          if (active.has(key)) {
            try { active.delete(key); } catch (_e) {}
            processed.push(copy);
            continue;
          }
          // allow if a prior ON exists in the batch at or before this off tick
          const batchOnTicks = (batchOnMap.get(key) || []).map(t => Math.round(Number(t))).filter(t => Number.isFinite(t));
          const hasPriorOnInBatch = batchOnTicks.some(t => t <= sanitizedTick);
          if (hasPriorOnInBatch) { processed.push(copy); continue; }
          // otherwise drop unmatched off
          try { if (_shouldTrace_writer) console.error(`[pushMultiple][DROP] dropping unmatched off type=${String(copy.type)} tick=${sanitizedTick} buffer=${(buffer && (buffer as any).name) || (Array.isArray(buffer) ? 'array' : 'unknown')} key=${key}`); } catch (_e) {}
          continue;
        }
      }

      processed.push(copy);
    }

  // Persist processed items into the provided buffer (CSVBuffer or plain array)
  try {
    if (buffer && typeof (buffer as any).push === 'function') {
      (buffer as any).push(...processed);
    } else if (Array.isArray(buffer)) {
      buffer.push(...processed);
    }
  } catch (_e) {}
};

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

  const LOGv = get('LOG', 'all');
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
  // If LOG explicitly set to 'none', do not emit any markers or logs
  if (LOGv === 'none') return;
  // Otherwise honor gating: if not allowed, skip
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

  // Broadcast section markers to all layer buffers when present (ensures per-layer markers parity)
  try {
    if (type === 'section' && source && source.LM && source.LM.layers) {
      for (const lname of Object.keys(source.LM.layers)) {
        try {
          const layerInfo = (source.LM.layers as any)[lname];
          const otherBuf = layerInfo && layerInfo.buffer ? layerInfo.buffer : null;
          if (otherBuf && otherBuf !== bufferTarget) {
            try { pFn(otherBuf, { ...markerObj }); } catch (_e) {}
          }
        } catch (_e) {}
      }
    }
  } catch (_e) {}
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

    // Determine track number (use 1 for all tracks) and output filename for this layer
    const trackNum = 1; // use track=1 in CSVs to keep downstream consumers consistent
    const outputFilename = (name === 'primary') ? 'output/output1.csv' : (name === 'poly') ? 'output/output2.csv' : `output/output${name.charAt(0).toUpperCase() + name.slice(1)}.csv`;

    const sectionEnd = layerState.sectionEnd ?? layerState.sectionStart ?? 0;
    const tpSec = layerState.tpSec ?? env.tpSec ?? 1;

    // NOTE: Leading note_off sanitization removed. Unmatched 'off' events should never be generated; enforcement is done at push time now.
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

        // Do not include unitHash in CSV output: emit numeric tick only
        const tickOut = tickVal; // unitHash retained in internal unit records but not emitted into CSV


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

    // Sanitize finalBuffer: drop unmatched 'off' events by scanning and maintaining an active-note set.
    try {
      const sanitizeFinalBuffer = (buf: any[]) => {
        const active = new Set<string>();
        const out: any[] = [];
        for (const evt of buf) {
          try {
            const typ = String(evt.type || '').toLowerCase();
            const isOnLike = (typ.includes('on') || (Array.isArray(evt.vals) && evt.vals.length >= 3));
            const isOffLike = (typ.includes('off') || (Array.isArray(evt.vals) && evt.vals.length === 2));
            if (isOnLike) {
              const ch = Number(evt.vals && evt.vals[0]);
              const note = Number(evt.vals && evt.vals[1]);
              if (Number.isFinite(ch) && Number.isFinite(note)) active.add(`${ch}:${note}`);
              out.push(evt);
              continue;
            }
            if (isOffLike) {
              const ch = Number(evt.vals && evt.vals[0]);
              const note = Number(evt.vals && evt.vals[1]);
              const key = `${ch}:${note}`;
              if (Number.isFinite(ch) && Number.isFinite(note)) {
                if (!active.has(key)) {
                  if (_shouldTrace_writer) console.error(`[grandFinale][DROP] dropping unmatched off tick=${evt.tick} buffer=${name} key=${key}`);
                  continue;
                }
                active.delete(key);
              }
              out.push(evt);
              continue;
            }
            out.push(evt);
          } catch (_e) {
            out.push(evt);
          }
        }
        return out;
      };
      const beforeSanitize = finalBuffer.length;
      finalBuffer = sanitizeFinalBuffer(finalBuffer);
      const afterSanitize = finalBuffer.length;
      if (afterSanitize < beforeSanitize) console.error(`[grandFinale][SANITIZE] layer=${name} dropped ${beforeSanitize - afterSanitize} unmatched 'off' events in sanitizeFinalBuffer`);

      // Additional safeguard: strip any leading 'off' events that occur before the first note-like event in the buffer.
      try {
        const firstNoteIndex = finalBuffer.findIndex((e: any) => e && (e.type === 'on' || String(e.type).toLowerCase().includes('note_on') || (Array.isArray(e.vals) && e.vals.length >= 3 && !String(e.type).toLowerCase().includes('off'))));
        if (firstNoteIndex > 0) {
          const beforeLeading = finalBuffer.length;
          finalBuffer = finalBuffer.filter((evt: any, idx: number) => {
            if (idx < firstNoteIndex) {
              const typ = String(evt && evt.type || '').toLowerCase();
              const isOffLike = typ.includes('off') || (Array.isArray(evt && evt.vals) && evt.vals.length === 2);
              if (isOffLike) return false;
            }
            return true;
          });
          const afterLeading = finalBuffer.length;
          if (afterLeading < beforeLeading) console.error(`[grandFinale][SANITIZE] layer=${name} stripped ${beforeLeading - afterLeading} leading 'off' events before first note`);
        }
      } catch (_e) {}
    } catch (_e) {}

    // Compute per-section offsets so events emitted with section-local ticks get placed on a
    // global absolute timeline when multiple sections are composed into the same output.
    try {
      // If no unit markers were found in the buffer, attempt to extract them from the timing tree *before* computing offsets
      try {
        if ((!unitsForLayer || unitsForLayer.length === 0) && env && env.state && env.state.timingTree && env.state.timingTree[name]) {
          const walkEarly = (node: any, pathParts: string[] = []) => {
            const found: any[] = [];
            if (!node || typeof node !== 'object') return found;
            const idx = (key: string) => {
              const i = pathParts.indexOf(key);
              if (i >= 0 && i + 1 < pathParts.length) return Number(pathParts[i + 1]);
              return undefined;
            };
            const sectionIndex = (node && Number.isFinite(Number(node.sectionIndex))) ? Number(node.sectionIndex) : idx('section');
            const phraseIndex = (node && Number.isFinite(Number(node.phraseIndex))) ? Number(node.phraseIndex) : idx('phrase');
            const measureIndex = (node && Number.isFinite(Number(node.measureIndex))) ? Number(node.measureIndex) : idx('measure');
            if (node.unitHash) {
              found.push({ unitHash: node.unitHash, layer: name, startTick: node.start ?? node.measureStart ?? 0, endTick: node.end ?? (Number(node.start ?? 0) + Number(node.tpMeasure ?? 0)), sectionIndex, phraseIndex, measureIndex });
            }
            if (node.children) {
              for (const k of Object.keys(node.children)) {
                found.push(...walkEarly(node.children[k], pathParts.concat(k)));
              }
            }
            for (const k of Object.keys(node)) {
              if (/^\d+$/.test(k) && typeof (node as any)[k] === 'object') {
                found.push(...walkEarly((node as any)[k], pathParts.concat(k)));
              }
            }
            return found;
          };
          const extractedEarly = walkEarly(env.state.timingTree[name]);
          if (extractedEarly && extractedEarly.length > 0) {
            unitsForLayer.push(...extractedEarly.map(u => ({ ...u, unitType: u.unitType || (u.measureIndex !== undefined ? 'measure' : (u.phraseIndex !== undefined ? 'phrase' : (u.sectionIndex !== undefined ? 'section' : undefined))) })));
          }
        }
      } catch (_e) {}

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
      try { console.error(`[grandFinale][DEBUG] layer=${name} sectionMaxEnd=${JSON.stringify(sectionMaxEnd)} sectionOffsets=${JSON.stringify(sectionOffsets)} sectionIndices=${JSON.stringify(sectionIndices)}`); } catch (_e) {}

      // Apply offsets to discovered units so units manifest records absolute ticks
      for (const u of unitsForLayer) {
        try { console.error(`[grandFinale][DEBUG] beforeOffset unitHash=${u.unitHash} sectionIndex=${u.sectionIndex} start=${u.startTick} end=${u.endTick}`); } catch (_e) {}
        if (u && u.sectionIndex !== undefined && Number.isFinite(Number(u.sectionIndex))) {
          const si = Number(u.sectionIndex);
          const off = sectionOffsets[si] || 0;
          u.startTick = Number(u.startTick || 0) + off;
          u.endTick = Number(u.endTick || 0) + off;
        }
        try { console.error(`[grandFinale][DEBUG] afterOffset unitHash=${u.unitHash} sectionIndex=${u.sectionIndex} start=${u.startTick} end=${u.endTick}`); } catch (_e) {}
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
            // Do not include unitHash in emitted tick yet; store it on the event for emission step
            evt.tick = `${tickVal}`;
          }

          // Record discovered unitHash on the event for downstream CSV emission and validation
          try { evt._unitHash = unitHashPart || (evt._unitHash ?? null); } catch (_e) { evt._unitHash = evt._unitHash ?? null; }
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
      if (_shouldTrace_writer) {
        console.error(`[grandFinale] DEBUG layer=${name} finalBuffer.total=${finalBuffer.length} noteLike=${noteLike.length}`);
        if (noteLike.length > 0) {
          console.error('[grandFinale] DEBUG sample noteLike events:\n', JSON.stringify(noteLike.slice(0, 10), null, 2).slice(0, 2000));
        }
      }
    } catch (_e) {}

    // Second sanitization pass AFTER unit/offset adjustments: remove unmatched 'off' events
    try {
      const beforeSecond = finalBuffer.length;
      const active = new Set<string>();
      const out: any[] = [];
      for (const evt of finalBuffer) {
        try {
          const typ = String(evt.type || '').toLowerCase();
          const isOnLike = (typ.includes('on') || (Array.isArray(evt.vals) && evt.vals.length >= 3));
          const isOffLike = (typ.includes('off') || (Array.isArray(evt.vals) && evt.vals.length === 2));
          if (isOnLike) {
            const ch = Number(evt.vals && evt.vals[0]);
            const note = Number(evt.vals && evt.vals[1]);
            if (Number.isFinite(ch) && Number.isFinite(note)) active.add(`${ch}:${note}`);
            out.push(evt);
            continue;
          }
          if (isOffLike) {
            const ch = Number(evt.vals && evt.vals[0]);
            const note = Number(evt.vals && evt.vals[1]);
            const key = `${ch}:${note}`;
            if (Number.isFinite(ch) && Number.isFinite(note)) {
              if (!active.has(key)) {
                if (_shouldTrace_writer) console.error(`[grandFinale][DROP2] dropping unmatched off tick=${evt.tick} buffer=${name} key=${key}`);
                continue;
              }
              active.delete(key);
            }
            out.push(evt);
            continue;
          }
          out.push(evt);
        } catch (_e) {
          out.push(evt);
        }
      }
      finalBuffer = out;
      const afterSecond = finalBuffer.length;
      if (afterSecond < beforeSecond) console.error(`[grandFinale][SANITIZE] layer=${name} removed ${beforeSecond - afterSecond} unmatched 'off' events in second pass`);
    } catch (_e) {}


    // Diagnostic: compose sample CSV lines as they would be emitted and log them for inspection
    try {
      const sampleLimit = 20;
      const composed = finalBuffer.slice(0, sampleLimit).map((evt: any) => {
        const t = evt && evt.type ? evt.type : '';
        const csvType = (t === 'on') ? 'note_on_c' : (String(t).toLowerCase().includes('off') ? 'note_off_c' : t);
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
        let outType = rawType === 'on' ? 'note_on_c' : (String(rawType).toLowerCase().includes('off') ? '' : (rawType || (Array.isArray(evt.vals) && evt.vals.length === 2 ? 'note_off_c' : rawType)));
        const valsArr = Array.isArray(evt.vals) ? evt.vals.map((v: any) => {
          if (typeof v === 'number') {
            if (!Number.isFinite(v)) return '0';
            return String(Math.round(v));
          }
          // Normalize newlines in vals using string-based split/join to avoid literal escapes in regex literals
          return String(v).split('\n').join(' ');
        }) : [];
        // Normalize tick numeric value
        let tickField: any = evt.tick;
        try {
          if (typeof tickField === 'string' && tickField.includes('|')) {
            const parts = String(tickField).split('|');
            tickField = Number(parts[0]);
          } else if (typeof tickField === 'string') {
            tickField = Number(tickField);
          }
        } catch (_e) {}

        // If a unitHash was discovered earlier, and this is a non-marker event, emit tick|unitHash
        try {
          const isMarker = String(rawType).toLowerCase() === 'marker_t' || String(rawType).toLowerCase().includes('marker');
          if (!isMarker && evt && evt._unitHash) {
            try { tickField = `${Number(tickField)}|${String(evt._unitHash)}`; } catch (_e) {}
          }
        } catch (_e) {}

        // Remove any unitHash tokens from vals to avoid leaking internal unit identifiers.
        // Some marker vals may be a single comma-delimited string; sanitize those entries by removing any 'unitHash:...' substrings.
        const filteredValsArr = (valsArr || []).map((v: any) => String(v).replace(/\bunitHash:[^,]+,?/g, '').replace(/,,+/g, ',').replace(/(^,|,$)/g, '').trim()).filter((s: string) => s.length > 0);
        // Map internal-only types to safe CSV-friendly types
        if (String(outType).toLowerCase() === 'unit_handoff') {
          // Emit handoff marker without the unit hash
          comp += `${trackNum},${tickField},marker_t,unit_handoff\n`;
        } else {
          comp += `${trackNum},${tickField},${outType}${filteredValsArr.length ? ',' + filteredValsArr.join(',') : ''}\n`;
        }
      }
      const lastTick = finalBuffer.length ? (finalBuffer[finalBuffer.length - 1]._tickSortKey || 0) : 0;
      const finalTick = lastTick + (env.PPQ || 480);
      comp += `${trackNum},${finalTick},end_track\n`;
      try { fsModule.mkdirSync(path.dirname(outputFilename), { recursive: true }); } catch (_e) {}
      // Post-process CSV to remove any internal unitHash tokens and tidy up commas/newlines
      try {
        comp = String(comp)
          // remove explicit unitHash tokens like 'unitHash:abcd12'
          .replace(/\bunitHash:[0-9A-Za-z]+,?/g, '')
          // normalize any 'off' identifier to an empty identifier (historical format) using per-line safe replacement
          .replace(/^([0-9]+),([0-9]+),\s*off\s*,/mg, '$1,$2,,')
          // process per-line to remove trailing unit-like tokens and trim edges (preserve empty identifier tokens)
          .split('\n')
          .map(l => l.replace(/,([0-9A-Za-z]{4,8})$/,'').replace(/(^,|,$)/g, ''))
          .join('\n');
      } catch (_e) {}
      fsModule.writeFileSync(outputFilename, comp);
      try {
        // Extra safeguard: read back file and post-process to ensure no unitHash tokens remain in on-disk CSVs
        let disk = fsModule.readFileSync(outputFilename, 'utf8');
        // Normalize any 'off' identifiers to empty identifier and remove unitHash tokens using per-line safe replacement
        let cleaned2 = String(disk).replace(/\bunitHash:[0-9A-Za-z]+,?/g, '').replace(/^([0-9]+),([0-9]+),\s*off\s*,/gmi, '$1,$2,,');
        const cleaned3 = String(cleaned2).split('\n').map(l => l.replace(/,([0-9A-Za-z]{4,8})$/,'').replace(/(^,|,$)/g, '')).join('\n');
        if (cleaned3 !== disk) {
          try { fsModule.writeFileSync(outputFilename, cleaned3); } catch (_e) {}
        }
      } catch (_e) {}
      console.log(`Wrote CSV for ${name} -> ${outputFilename} (rows=${finalBuffer.length})`);
    } catch (_e) {
      if (_shouldTrace_writer) console.error('[grandFinale] failed to write CSV for layer', name, _e);
    }
    try {
      try { console.error(`[grandFinale][DEBUG] layer=${name} timingTreePresent=${Boolean(env && env.state && env.state.timingTree && env.state.timingTree[name])} layerKeys=${env && env.state && env.state.timingTree && env.state.timingTree[name] ? Object.keys(env.state.timingTree[name]) : 'none'}`); } catch (_e) {}
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
            // Debug: inspect extracted units for layer-level anomalies
            try { console.error(`[grandFinale][DEBUG] layer=${name} extractedUnits=${extracted.length} sample=${JSON.stringify(extracted.slice(0,10))}`); } catch (_e) {}
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
    try { console.error(`[grandFinale][DEBUG] unitsToWrite=${allUnits.length} sample=${JSON.stringify(allUnits.slice(0,10))}`); } catch (_e) {}
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
      if (_shouldTrace_writer) console.error(`[grandFinale] DEBUG total note pushes observed (global counter) = ${pushed}`);
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
          if (_shouldTrace_writer) console.error(`[grandFinale][DIAG] file=${pth} totalLines=${lines.length} note-like lines=${noteLines.length}`);
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
  if (_shouldTrace_writer) console.error(msg);
  throw new Error(msg);
}

// NOTE: Global exposure layer was removed in favor of DI-only usage.
// Call `registerWriterServices(container)` in test setup and use the produced
// services via `ctx.services.get('pushMultiple')` or `getWriterServices(ctx)`.
// The legacy `p` global is deprecated and should not be used.
