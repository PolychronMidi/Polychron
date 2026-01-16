"use strict";
// time.ts - Timing engine with meter spoofing and dual-layer polyrhythm support.
// minimalist comments, details at: time.md
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatTime = exports.setUnitTiming = exports.getPolyrhythm = exports.setMidiTiming = exports.getMidiTiming = exports.LayerManager = exports.TimingContext = exports.TimingCalculator = void 0;
const TimingCalculator_1 = require("./time/TimingCalculator");
Object.defineProperty(exports, "TimingCalculator", { enumerable: true, get: function () { return TimingCalculator_1.TimingCalculator; } });
const TimingContext_1 = require("./time/TimingContext");
Object.defineProperty(exports, "TimingContext", { enumerable: true, get: function () { return TimingContext_1.TimingContext; } });
const LayerManager_1 = require("./time/LayerManager");
Object.defineProperty(exports, "LayerManager", { enumerable: true, get: function () { return LayerManager_1.LayerManager; } });
let timingCalculator = null;
/**
 * Compute MIDI-compatible meter and tempo sync factor.
 * Sets: midiMeter, midiMeterRatio, syncFactor, midiBPM, tpSec, tpMeasure, spMeasure.
 */
const getMidiTiming = () => {
    timingCalculator = new TimingCalculator_1.TimingCalculator({ bpm: BPM, ppq: PPQ, meter: [numerator, denominator] });
    const g = globalThis;
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
exports.getMidiTiming = getMidiTiming;
/**
 * Writes MIDI timing events to active buffer (c).
 * Context-aware: writes to c1 or c2 depending on current meter.
 */
const setMidiTiming = (tick = globalThis.measureStart) => {
    const g = globalThis;
    if (!Number.isFinite(g.tpSec) || g.tpSec <= 0) {
        throw new Error(`Invalid tpSec: ${g.tpSec}`);
    }
    g.p(g.c, { tick: tick, type: 'bpm', vals: [g.midiBPM] }, { tick: tick, type: 'meter', vals: [g.midiMeter[0], g.midiMeter[1]] });
};
exports.setMidiTiming = setMidiTiming;
/**
 * Compute phrase alignment between primary and poly meters in seconds.
 * Sets: measuresPerPhrase1, measuresPerPhrase2.
 */
const getPolyrhythm = () => {
    const g = globalThis;
    if (!g.composer)
        return;
    const MAX_ATTEMPTS = 100;
    let attempts = 0;
    while (attempts++ < MAX_ATTEMPTS) {
        [g.polyNumerator, g.polyDenominator] = g.composer.getMeter(true, true);
        if (!Number.isFinite(g.polyNumerator) || !Number.isFinite(g.polyDenominator) || g.polyDenominator <= 0) {
            continue;
        }
        g.polyMeterRatio = g.polyNumerator / g.polyDenominator;
        let allMatches = [];
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
exports.getPolyrhythm = getPolyrhythm;
/**
 * Set timing variables for each unit level. Calculates absolute positions using
 * cascading parent position + index × duration pattern. See time.md for details.
 */
const setUnitTiming = (unitType) => {
    const g = globalThis;
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
            g.beatRhythm = g.setRhythm('beat');
            break;
        case 'beat':
            g.trackBeatRhythm();
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
            g.divRhythm = g.setRhythm('div');
            break;
        case 'division':
            g.trackDivRhythm();
            g.tpDiv = g.tpBeat / Math.max(1, g.divsPerBeat);
            g.spDiv = g.tpDiv / g.tpSec;
            g.divStart = g.beatStart + g.divIndex * g.tpDiv;
            g.divStartTime = g.beatStartTime + g.divIndex * g.spDiv;
            g.subdivsPerDiv = Math.max(1, g.composer ? g.composer.getSubdivisions() : 1);
            g.subdivFreq = g.subdivsPerDiv * g.divsPerBeat * g.numerator * g.meterRatio;
            g.subdivRhythm = g.setRhythm('subdiv');
            break;
        case 'subdivision':
            g.trackSubdivRhythm();
            g.tpSubdiv = g.tpDiv / Math.max(1, g.subdivsPerDiv);
            g.spSubdiv = g.tpSubdiv / g.tpSec;
            g.subdivsPerMinute = 60 / g.spSubdiv;
            g.subdivStart = g.divStart + g.subdivIndex * g.tpSubdiv;
            g.subdivStartTime = g.divStartTime + g.subdivIndex * g.spSubdiv;
            g.subsubdivsPerSub = g.composer ? g.composer.getSubsubdivs() : 1;
            g.subsubdivRhythm = g.setRhythm('subsubdiv');
            break;
        case 'subsubdivision':
            g.trackSubsubdivRhythm();
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
exports.setUnitTiming = setUnitTiming;
/**
 * Format seconds as MM:SS.ssss time string.
 */
const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(4).padStart(7, '0');
    return `${minutes}:${secs}`;
};
exports.formatTime = formatTime;
// Export to global scope for backward compatibility
globalThis.getMidiTiming = getMidiTiming;
globalThis.setMidiTiming = setMidiTiming;
globalThis.getPolyrhythm = getPolyrhythm;
globalThis.setUnitTiming = setUnitTiming;
globalThis.formatTime = formatTime;
globalThis.TimingCalculator = TimingCalculator_1.TimingCalculator;
globalThis.TimingContext = TimingContext_1.TimingContext;
globalThis.LM = LayerManager_1.LayerManager;
globalThis.layerManager = LayerManager_1.LayerManager;
// Export for tests
if (typeof globalThis !== 'undefined') {
    globalThis.__POLYCHRON_TEST__ = globalThis.__POLYCHRON_TEST__ || {};
    Object.assign(globalThis.__POLYCHRON_TEST__, {
        TimingCalculator: TimingCalculator_1.TimingCalculator,
        TimingContext: TimingContext_1.TimingContext,
        LayerManager: LayerManager_1.LayerManager,
        getMidiTiming,
        setMidiTiming,
        getPolyrhythm,
        setUnitTiming,
        formatTime
    });
}
//# sourceMappingURL=time.js.map