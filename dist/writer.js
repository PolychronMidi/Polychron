"use strict";
// writer.js - MIDI output and file generation with CSV buffer management.
// minimalist comments, details at: writer.md
/**
 * Layer-aware MIDI event buffer.
 * @class CSVBuffer
 * @param {string} name - Layer identifier ('primary', 'poly', etc.).
 * @property {string} name - Layer identifier.
 * @property {Array<object>} rows - MIDI event objects: {tick, type, vals}.
 * @property {number} length - Read-only count of events.
 */
CSVBuffer = class CSVBuffer {
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
};
/**
 * Push multiple items onto a buffer/array.
 * @param {CSVBuffer|Array} buffer - The target buffer to push onto.
 * @param {...*} items - Items to push onto the buffer.
 * @returns {void}
 */
p = pushMultiple = (buffer, ...items) => { buffer.push(...items); };
// Initialize buffers (c1/c2 created here, layers register them in play.js)
c1 = new CSVBuffer('primary');
c2 = new CSVBuffer('poly');
c = c1; // Active buffer reference
/**
 * Logs timing markers with context awareness.
 * Writes to active buffer (c = c1 or c2) for proper file separation.
 *
 * @param {string} type - Unit type: 'section', 'phrase', 'measure', 'beat', 'division', 'subdivision', 'subsubdivision'
 */
logUnit = (type) => {
    let shouldLog = false;
    type = type.toLowerCase();
    if (LOG === 'none')
        shouldLog = false;
    else if (LOG === 'all')
        shouldLog = true;
    else {
        const logList = LOG.toLowerCase().split(',').map(item => item.trim());
        shouldLog = logList.length === 1 ? logList[0] === type : logList.includes(type);
    }
    if (!shouldLog)
        return null;
    let meterInfo = '';
    if (type === 'section') {
        unit = sectionIndex + 1;
        unitsPerParent = totalSections;
        startTick = sectionStart;
        spSection = tpSection / tpSec;
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
        spPhrase = tpPhrase / tpSec;
        endTime = startTime + spPhrase;
        composerDetails = composer ? `${composer.constructor.name} ` : 'Unknown Composer ';
        if (composer && composer.scale && composer.scale.name) {
            composerDetails += `${composer.root} ${composer.scale.name}`;
        }
        else if (composer && composer.progression) {
            progressionSymbols = composer.progression.map(chord => {
                return chord && chord.symbol ? chord.symbol : '[Unknown Symbol]';
            }).join(' ');
            composerDetails += `${progressionSymbols}`;
        }
        else if (composer && composer.mode && composer.mode.name) {
            composerDetails += `${composer.root} ${composer.mode.name}`;
        }
        actualMeter = [numerator, denominator];
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
        composerDetails = composer ? `${composer.constructor.name} ` : 'Unknown Composer ';
        if (composer && composer.scale && composer.scale.name) {
            composerDetails += `${composer.root} ${composer.scale.name}`;
        }
        else if (composer && composer.progression) {
            progressionSymbols = composer.progression.map(chord => {
                return chord && chord.symbol ? chord.symbol : '[Unknown Symbol]';
            }).join(' ');
            composerDetails += `${progressionSymbols}`;
        }
        else if (composer && composer.mode && composer.mode.name) {
            composerDetails += `${composer.root} ${composer.mode.name}`;
        }
        actualMeter = [numerator, denominator];
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
    return (() => {
        c.push({
            tick: startTick,
            type: 'marker_t',
            vals: [`${type.charAt(0).toUpperCase() + type.slice(1)} ${unit}/${unitsPerParent} Length: ${formatTime(endTime - startTime)} (${formatTime(startTime)} - ${formatTime(endTime)}) endTick: ${endTick} ${meterInfo ? meterInfo : ''}`]
        });
    })();
};
/**
 * Outputs separate MIDI files for each layer with automatic synchronization.
 * @description
 * Architecture:
 * - output1.csv/mid: Primary layer with its syncFactor
 * - output2.csv/mid: Poly layer with independent syncFactor
 * - output3.csv/mid+: Additional layers (when added)
 * - Phrase boundaries align perfectly in absolute time (seconds)
 * - Tick counts differ due to different tempo adjustments
 * - Automatically handles any number of layers
 * @returns {void}
 */
grandFinale = () => {
    // Collect all layer data
    const layerData = Object.entries(LM.layers).map(([name, layer]) => {
        return {
            name,
            layer: layer.state,
            buffer: layer.buffer instanceof CSVBuffer ? layer.buffer.rows : layer.buffer
        };
    });
    // Process each layer's output
    layerData.forEach(({ name, layer: layerState, buffer }) => {
        c = buffer;
        // Cleanup
        allNotesOff((layerState.sectionEnd || layerState.sectionStart) + PPQ);
        muteAll((layerState.sectionEnd || layerState.sectionStart) + PPQ * 2);
        // Finalize buffer
        buffer = buffer.filter(i => i !== null)
            .map(i => ({
            ...i,
            tick: isNaN(i.tick) || i.tick < 0 ? Math.abs(i.tick || 0) * rf(.1, .3) : i.tick
        }))
            .sort((a, b) => a.tick - b.tick);
        // Generate CSV
        let composition = `0,0,header,1,1,${PPQ}\n1,0,start_track\n`;
        let finalTick = -Infinity;
        buffer.forEach(_ => {
            if (!isNaN(_.tick)) {
                let type = _.type === 'on' ? 'note_on_c' : (_.type || 'note_off_c');
                composition += `1,${_.tick || 0},${type},${_.vals.join(',')}\n`;
                finalTick = Math.max(finalTick, _.tick);
            }
        });
        composition += `1,${finalTick + (SILENT_OUTRO_SECONDS * layerState.tpSec)},end_track`;
        // Determine output filename based on layer name
        let outputFilename;
        if (name === 'primary') {
            outputFilename = 'output/output1.csv';
        }
        else if (name === 'poly') {
            outputFilename = 'output/output2.csv';
        }
        else {
            // For additional layers, use name-based numbering
            outputFilename = `output/output${name.charAt(0).toUpperCase() + name.slice(1)}.csv`;
        }
        // Ensure output directory exists
        const path = require('path');
        const outputDir = path.dirname(outputFilename);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        fs.writeFileSync(outputFilename, composition);
        console.log(`${outputFilename} created (${name} layer).`);
    });
};
/**
 * Node.js filesystem module with wrapped writeFileSync for error logging.
 * @type {Object}
 */
fs = require('fs');
// Wrap writeFileSync to log errors centrally
try {
    const _origWriteFileSync = fs.writeFileSync;
    fs.writeFileSync = function (...args) {
        try {
            return _origWriteFileSync.apply(fs, args);
        }
        catch (err) {
            console.error('Failed to write', args[0] || '', err);
            throw err;
        }
    };
}
catch (err) {
    console.error('Failed to wrap fs.writeFileSync:', err);
}
// Export to globalThis test namespace for clean test access
if (typeof globalThis !== 'undefined') {
    globalThis.__POLYCHRON_TEST__ = globalThis.__POLYCHRON_TEST__ || {};
    Object.assign(globalThis.__POLYCHRON_TEST__, { p });
}
//# sourceMappingURL=writer.js.map
