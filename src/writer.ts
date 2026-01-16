// writer.ts - MIDI output and file generation with CSV buffer management.
// minimalist comments, details at: writer.md

import * as fs from 'fs';
import * as path from 'path';

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

// Alias for backward compatibility
const p = pushMultiple;

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
declare let subsubsPerSub: number;
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
export const logUnit = (type: string): void => {
  let shouldLog = false;
  type = type.toLowerCase();

  if (LOG === 'none') {
    shouldLog = false;
  } else if (LOG === 'all') {
    shouldLog = true;
  } else {
    const logList = LOG.toLowerCase().split(',').map(item => item.trim());
    shouldLog = logList.length === 1 ? logList[0] === type : logList.includes(type);
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
    unit = sectionIndex + 1;
    unitsPerParent = totalSections;
    startTick = sectionStart;
    const spSection = tpSection / tpSec;
    endTick = startTick + tpSection;
    startTime = sectionStartTime;
    endTime = startTime + spSection;
  } else if (type === 'phrase') {
    unit = phraseIndex + 1;
    unitsPerParent = phrasesPerSection;
    startTick = phraseStart;
    endTick = startTick + tpPhrase;
    startTime = phraseStartTime;
    const spPhrase = tpPhrase / tpSec;
    endTime = startTime + spPhrase;

    let composerDetails = composer ? `${composer.constructor.name} ` : 'Unknown Composer ';
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

    const actualMeter: [number, number] = [numerator, denominator];
    meterInfo = midiMeter[1] === actualMeter[1]
      ? `Meter: ${actualMeter.join('/')} Composer: ${composerDetails} tpSec: ${tpSec}`
      : `Actual Meter: ${actualMeter.join('/')} MIDI Meter: ${midiMeter.join('/')} Composer: ${composerDetails} tpSec: ${tpSec}`;
  } else if (type === 'measure') {
    unit = measureIndex + 1;
    unitsPerParent = measuresPerPhrase;
    startTick = measureStart;
    endTick = measureStart + tpMeasure;
    startTime = measureStartTime;
    endTime = measureStartTime + spMeasure;

    let composerDetails = composer ? `${composer.constructor.name} ` : 'Unknown Composer ';
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

    const actualMeter: [number, number] = [numerator, denominator];
    meterInfo = midiMeter[1] === actualMeter[1]
      ? `Meter: ${actualMeter.join('/')} Composer: ${composerDetails} tpSec: ${tpSec}`
      : `Actual Meter: ${actualMeter.join('/')} MIDI Meter: ${midiMeter.join('/')} Composer: ${composerDetails} tpSec: ${tpSec}`;
  } else if (type === 'beat') {
    unit = beatIndex + 1;
    unitsPerParent = numerator;
    startTick = beatStart;
    endTick = startTick + tpBeat;
    startTime = beatStartTime;
    endTime = startTime + spBeat;
  } else if (type === 'division') {
    unit = divIndex + 1;
    unitsPerParent = divsPerBeat;
    startTick = divStart;
    endTick = startTick + tpDiv;
    startTime = divStartTime;
    endTime = startTime + spDiv;
  } else if (type === 'subdivision') {
    unit = subdivIndex + 1;
    unitsPerParent = subdivsPerDiv;
    startTick = subdivStart;
    endTick = startTick + tpSubdiv;
    startTime = subdivStartTime;
    endTime = startTime + spSubdiv;
  } else if (type === 'subsubdivision') {
    unit = subsubdivIndex + 1;
    unitsPerParent = subsubsPerSub;
    startTick = subsubdivStart;
    endTick = startTick + tpSubsubdiv;
    startTime = subsubdivStartTime;
    endTime = startTime + spSubsubdiv;
  }

  c.push({
    tick: startTick,
    type: 'marker_t',
    vals: [`${type.charAt(0).toUpperCase() + type.slice(1)} ${unit}/${unitsPerParent} Length: ${formatTime(endTime - startTime)} (${formatTime(startTime)} - ${formatTime(endTime)}) endTick: ${endTick} ${meterInfo ? meterInfo : ''}`]
  });
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
export const grandFinale = (): void => {
  const g = globalThis as any;

  // Collect all layer data
  const layerData = Object.entries(g.LM.layers).map(([name, layer]: [string, any]) => {
    return {
      name,
      layer: layer.state,
      buffer: layer.buffer instanceof CSVBuffer ? layer.buffer.rows : layer.buffer
    };
  });

  // Process each layer's output
  layerData.forEach(({ name, layer: layerState, buffer: bufferData }: any) => {
    g.c = bufferData;

    // Cleanup
    g.allNotesOff((layerState.sectionEnd || layerState.sectionStart) + g.PPQ);
    g.muteAll((layerState.sectionEnd || layerState.sectionStart) + g.PPQ * 2);

    // Finalize buffer
    let finalBuffer = (Array.isArray(bufferData) ? bufferData : bufferData.rows)
      .filter((i: any) => i !== null)
      .map((i: any) => ({
        ...i,
        tick: isNaN(i.tick) || i.tick < 0 ? Math.abs(i.tick || 0) * g.rf(.1, .3) : i.tick
      }))
      .sort((a: any, b: any) => a.tick - b.tick);

    // Generate CSV
    let composition = `0,0,header,1,1,${g.PPQ}\n1,0,start_track\n`;
    let finalTick = -Infinity;

    finalBuffer.forEach((evt: any) => {
      if (!isNaN(evt.tick)) {
        const type = evt.type === 'on' ? 'note_on_c' : (evt.type || 'note_off_c');
        composition += `1,${evt.tick || 0},${type},${evt.vals.join(',')}\n`;
        finalTick = Math.max(finalTick, evt.tick);
      }
    });

    composition += `1,${finalTick + (g.SILENT_OUTRO_SECONDS * layerState.tpSec)},end_track`;

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
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputFilename, composition);
    console.log(`${outputFilename} created (${name} layer).`);
  });
};

// Export to global scope for backward compatibility
(globalThis as any).CSVBuffer = CSVBuffer;
(globalThis as any).p = p;
(globalThis as any).pushMultiple = pushMultiple;
(globalThis as any).c1 = c1;
(globalThis as any).c2 = c2;
(globalThis as any).c = c;
(globalThis as any).logUnit = logUnit;
(globalThis as any).grandFinale = grandFinale;

// Export for tests
if (typeof globalThis !== 'undefined') {
  (globalThis as any).__POLYCHRON_TEST__ = (globalThis as any).__POLYCHRON_TEST__ || {};
  Object.assign((globalThis as any).__POLYCHRON_TEST__, {
    CSVBuffer,
    p,
    pushMultiple,
    logUnit,
    grandFinale
  });
}
