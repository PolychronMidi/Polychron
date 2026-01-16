"use strict";
// writer.ts - MIDI output and file generation with CSV buffer management.
// minimalist comments, details at: writer.md
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.grandFinale = exports.logUnit = exports.pushMultiple = exports.CSVBuffer = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Layer-aware MIDI event buffer.
 */
class CSVBuffer {
    constructor(name) {
        this.name = name;
        this.rows = [];
    }
    push(...items) {
        this.rows.push(...items);
    }
    get length() {
        return this.rows.length;
    }
    clear() {
        this.rows = [];
    }
}
exports.CSVBuffer = CSVBuffer;
/**
 * Push multiple items onto a buffer/array.
 */
const pushMultiple = (buffer, ...items) => {
    if (buffer instanceof CSVBuffer) {
        buffer.push(...items);
    }
    else if (Array.isArray(buffer)) {
        buffer.push(...items);
    }
};
exports.pushMultiple = pushMultiple;
// Alias for backward compatibility
const p = exports.pushMultiple;
// Initialize buffers (c1/c2 created here, layers register them in play.js)
const c1 = new CSVBuffer('primary');
const c2 = new CSVBuffer('poly');
let c = c1; // Active buffer reference
/**
 * Logs timing markers with context awareness.
 * Writes to active buffer (c = c1 or c2) for proper file separation.
 */
const logUnit = (type) => {
    const LOG = globalThis.LOG || 'none';
    let shouldLog = false;
    type = type.toLowerCase();
    if (LOG === 'none') {
        shouldLog = false;
    }
    else if (LOG === 'all') {
        shouldLog = true;
    }
    else {
        const logList = LOG.toLowerCase().split(',').map(item => item.trim());
        shouldLog = logList.length === 1 ? logList[0] === type : logList.includes(type);
    }
    if (!shouldLog)
        return;
    let unit = 0;
    let unitsPerParent = 0;
    let startTick = 0;
    let endTick = 0;
    let startTime = 0;
    let endTime = 0;
    let meterInfo = '';
    const sectionIndex = globalThis.sectionIndex || 0;
    const totalSections = globalThis.totalSections || 1;
    const sectionStart = globalThis.sectionStart || 0;
    const sectionStartTime = globalThis.sectionStartTime || 0;
    const tpSection = globalThis.tpSection || 0;
    const tpSec = globalThis.tpSec || 1;
    const phraseIndex = globalThis.phraseIndex || 0;
    const phrasesPerSection = globalThis.phrasesPerSection || 1;
    const phraseStart = globalThis.phraseStart || 0;
    const phraseStartTime = globalThis.phraseStartTime || 0;
    const tpPhrase = globalThis.tpPhrase || 0;
    const numerator = globalThis.numerator || 4;
    const denominator = globalThis.denominator || 4;
    const midiMeter = globalThis.midiMeter || [4, 4];
    const composer = globalThis.composer || null;
    const measureIndex = globalThis.measureIndex || 0;
    const measuresPerPhrase = globalThis.measuresPerPhrase || 1;
    const measureStart = globalThis.measureStart || 0;
    const measureStartTime = globalThis.measureStartTime || 0;
    const tpMeasure = globalThis.tpMeasure || 0;
    const spMeasure = globalThis.spMeasure || 0;
    const beatIndex = globalThis.beatIndex || 0;
    const beatStart = globalThis.beatStart || 0;
    const beatStartTime = globalThis.beatStartTime || 0;
    const tpBeat = globalThis.tpBeat || 0;
    const spBeat = globalThis.spBeat || 0;
    const divIndex = globalThis.divIndex || 0;
    const divsPerBeat = globalThis.divsPerBeat || 4;
    const divStart = globalThis.divStart || 0;
    const divStartTime = globalThis.divStartTime || 0;
    const tpDiv = globalThis.tpDiv || 0;
    const spDiv = globalThis.spDiv || 0;
    const subdivIndex = globalThis.subdivIndex || 0;
    const subdivsPerDiv = globalThis.subdivsPerDiv || 4;
    const subdivStart = globalThis.subdivStart || 0;
    const subdivStartTime = globalThis.subdivStartTime || 0;
    const tpSubdiv = globalThis.tpSubdiv || 0;
    const spSubdiv = globalThis.spSubdiv || 0;
    const subsubdivIndex = globalThis.subsubdivIndex || 0;
    const subsubsPerSub = globalThis.subsubsPerSub || 4;
    const subsubdivStart = globalThis.subsubdivStart || 0;
    const subsubdivStartTime = globalThis.subsubdivStartTime || 0;
    const tpSubsubdiv = globalThis.tpSubsubdiv || 0;
    const spSubsubdiv = globalThis.spSubsubdiv || 0;
    const formatTime = globalThis.formatTime || ((t) => t.toFixed(3));
    if (type === 'section') {
        unit = sectionIndex + 1;
        unitsPerParent = totalSections;
        startTick = sectionStart;
        const spSection = tpSection / tpSec;
        endTick = startTick + tpSection;
        startTime = sectionStartTime;
        endTime = startTime + spSection;
    }
    else if (type === 'phrase') {
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
        }
        else if (composer && composer.progression) {
            const progressionSymbols = composer.progression.map((chord) => {
                return chord && chord.symbol ? chord.symbol : '[Unknown Symbol]';
            }).join(' ');
            composerDetails += progressionSymbols;
        }
        else if (composer && composer.mode && composer.mode.name) {
            composerDetails += `${composer.root} ${composer.mode.name}`;
        }
        const actualMeter = [numerator, denominator];
        meterInfo = midiMeter[1] === actualMeter[1]
            ? `Meter: ${actualMeter.join('/')} Composer: ${composerDetails} tpSec: ${tpSec}`
            : `Actual Meter: ${actualMeter.join('/')} MIDI Meter: ${midiMeter.join('/')} Composer: ${composerDetails} tpSec: ${tpSec}`;
    }
    else if (type === 'measure') {
        unit = measureIndex + 1;
        unitsPerParent = measuresPerPhrase;
        startTick = measureStart;
        endTick = measureStart + tpMeasure;
        startTime = measureStartTime;
        endTime = measureStartTime + spMeasure;
        let composerDetails = composer ? `${composer.constructor.name} ` : 'Unknown Composer ';
        if (composer && composer.scale && composer.scale.name) {
            composerDetails += `${composer.root} ${composer.scale.name}`;
        }
        else if (composer && composer.progression) {
            const progressionSymbols = composer.progression.map((chord) => {
                return chord && chord.symbol ? chord.symbol : '[Unknown Symbol]';
            }).join(' ');
            composerDetails += progressionSymbols;
        }
        else if (composer && composer.mode && composer.mode.name) {
            composerDetails += `${composer.root} ${composer.mode.name}`;
        }
        const actualMeter = [numerator, denominator];
        meterInfo = midiMeter[1] === actualMeter[1]
            ? `Meter: ${actualMeter.join('/')} Composer: ${composerDetails} tpSec: ${tpSec}`
            : `Actual Meter: ${actualMeter.join('/')} MIDI Meter: ${midiMeter.join('/')} Composer: ${composerDetails} tpSec: ${tpSec}`;
    }
    else if (type === 'beat') {
        unit = beatIndex + 1;
        unitsPerParent = numerator;
        startTick = beatStart;
        endTick = startTick + tpBeat;
        startTime = beatStartTime;
        endTime = startTime + spBeat;
    }
    else if (type === 'division') {
        unit = divIndex + 1;
        unitsPerParent = divsPerBeat;
        startTick = divStart;
        endTick = startTick + tpDiv;
        startTime = divStartTime;
        endTime = startTime + spDiv;
    }
    else if (type === 'subdivision') {
        unit = subdivIndex + 1;
        unitsPerParent = subdivsPerDiv;
        startTick = subdivStart;
        endTick = startTick + tpSubdiv;
        startTime = subdivStartTime;
        endTime = startTime + spSubdiv;
    }
    else if (type === 'subsubdivision') {
        unit = subsubdivIndex + 1;
        unitsPerParent = subsubsPerSub;
        startTick = subsubdivStart;
        endTick = startTick + tpSubsubdiv;
        startTime = subsubdivStartTime;
        endTime = startTime + spSubsubdiv;
    }
    // Use the active buffer (c) which should be set to the layer-specific buffer
    if (typeof globalThis.c !== 'undefined' && globalThis.c !== null) {
        globalThis.c.push({
            tick: startTick,
            type: 'marker_t',
            vals: [`${type.charAt(0).toUpperCase() + type.slice(1)} ${unit}/${unitsPerParent} Length: ${formatTime(endTime - startTime)} (${formatTime(startTime)} - ${formatTime(endTime)}) endTick: ${endTick} ${meterInfo ? meterInfo : ''}`]
        });
    }
};;
exports.logUnit = logUnit;
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
const grandFinale = () => {
    const g = globalThis;
    // Use globalThis.fs if available (for testing), otherwise use the real fs module
    const fileSystem = typeof g.fs !== 'undefined' ? g.fs : fs;
    // Collect all layer data
    const layerData = Object.entries(g.LM.layers).map(([name, layer]) => {
        return {
            name,
            layer: layer.state,
            buffer: layer.buffer instanceof CSVBuffer ? layer.buffer.rows : layer.buffer
        };
    });
    // Process each layer's output
    layerData.forEach(({ name, layer: layerState, buffer: bufferData }) => {
        // Set the global c variable to the layer-specific buffer
        g.c = bufferData;
        // Cleanup
        g.allNotesOff((layerState.sectionEnd || layerState.sectionStart) + g.PPQ);
        g.muteAll((layerState.sectionEnd || layerState.sectionStart) + g.PPQ * 2);
        // Finalize buffer
        let finalBuffer = (Array.isArray(bufferData) ? bufferData : bufferData.rows)
            .filter((i) => i !== null)
            .map((i) => ({
            ...i,
            tick: isNaN(i.tick) || i.tick < 0 ? Math.abs(i.tick || 0) * (g.rf ? g.rf(.1, .3) : 0.2) : i.tick
        }))
            .sort((a, b) => a.tick - b.tick);
        // Generate CSV
        let composition = `0,0,header,1,1,${g.PPQ}\n1,0,start_track\n`;
        let finalTick = -Infinity;
        finalBuffer.forEach((evt) => {
            if (!isNaN(evt.tick)) {
                const type = evt.type === 'on' ? 'note_on_c' : (evt.type || 'note_off_c');
                composition += `1,${evt.tick || 0},${type},${evt.vals.join(',')}\n`;
                finalTick = Math.max(finalTick, evt.tick);
            }
        });
        composition += `1,${finalTick + (g.SILENT_OUTRO_SECONDS * layerState.tpSec)},end_track`;
        // Determine output filename based on layer name
        let outputFilename;
        if (name === 'primary') {
            outputFilename = 'output/output1.csv';
        }
        else if (name === 'poly') {
            outputFilename = 'output/output2.csv';
        }
        else {
            outputFilename = `output/output${name.charAt(0).toUpperCase() + name.slice(1)}.csv`;
        }
        // Ensure output directory exists
        const outputDir = path.dirname(outputFilename);
        if (!fileSystem.existsSync(outputDir)) {
            fileSystem.mkdirSync(outputDir, { recursive: true });
        }
        fileSystem.writeFileSync(outputFilename, composition);
        console.log(`${outputFilename} created (${name} layer).`);
    });
};
exports.grandFinale = grandFinale;
// Export to global scope for backward compatibility
globalThis.CSVBuffer = CSVBuffer;
globalThis.p = p;
globalThis.pushMultiple = exports.pushMultiple;
globalThis.c1 = c1;
globalThis.c2 = c2;
globalThis.c = c;
globalThis.logUnit = exports.logUnit;
globalThis.grandFinale = exports.grandFinale;
// Export for tests
if (typeof globalThis !== 'undefined') {
    globalThis.__POLYCHRON_TEST__ = globalThis.__POLYCHRON_TEST__ || {};
    Object.assign(globalThis.__POLYCHRON_TEST__, {
        CSVBuffer,
        p,
        pushMultiple: exports.pushMultiple,
        logUnit: exports.logUnit,
        grandFinale: exports.grandFinale
    });
}
//# sourceMappingURL=writer.js.map
