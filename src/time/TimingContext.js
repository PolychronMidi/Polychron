"use strict";
// TimingContext.ts - Timing state management for layers.
// minimalist comments, details at: time.md
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimingContext = void 0;
/**
 * TimingContext class - encapsulates all timing state for a layer.
 * Provides methods to save/restore timing state and advance timing.
 */
class TimingContext {
    constructor(initialState = {}) {
        this.phraseStart = initialState.phraseStart || 0;
        this.phraseStartTime = initialState.phraseStartTime || 0;
        this.sectionStart = initialState.sectionStart || 0;
        this.sectionStartTime = initialState.sectionStartTime || 0;
        this.sectionEnd = initialState.sectionEnd || 0;
        this.tpSec = initialState.tpSec || 0;
        this.tpSection = initialState.tpSection || 0;
        this.spSection = initialState.spSection || 0;
        this.numerator = initialState.numerator || 4;
        this.denominator = initialState.denominator || 4;
        this.measuresPerPhrase = initialState.measuresPerPhrase || 1;
        this.tpPhrase = initialState.tpPhrase || 0;
        this.spPhrase = initialState.spPhrase || 0;
        this.measureStart = initialState.measureStart || 0;
        this.measureStartTime = initialState.measureStartTime || 0;
        this.tpMeasure = initialState.tpMeasure || (typeof globalThis.PPQ !== 'undefined' ? globalThis.PPQ * 4 : 480 * 4);
        this.spMeasure = initialState.spMeasure || 0;
        this.meterRatio = initialState.meterRatio || (this.numerator / this.denominator);
        this.bufferName = initialState.bufferName || '';
    }
    /**
     * Save timing values from globals object.
     */
    saveFrom(globals) {
        this.phraseStart = globals.phraseStart;
        this.phraseStartTime = globals.phraseStartTime;
        this.sectionStart = globals.sectionStart;
        this.sectionStartTime = globals.sectionStartTime;
        this.sectionEnd = globals.sectionEnd;
        this.tpSec = globals.tpSec;
        this.tpSection = globals.tpSection;
        this.spSection = globals.spSection;
        this.numerator = globals.numerator;
        this.denominator = globals.denominator;
        this.measuresPerPhrase = globals.measuresPerPhrase;
        this.tpPhrase = globals.tpPhrase;
        this.spPhrase = globals.spPhrase;
        this.measureStart = globals.measureStart;
        this.measureStartTime = globals.measureStartTime;
        this.tpMeasure = globals.tpMeasure;
        this.spMeasure = globals.spMeasure;
        this.meterRatio = globals.numerator / globals.denominator;
    }
    /**
     * Restore timing values to globals object.
     */
    restoreTo(globals) {
        globals.phraseStart = this.phraseStart;
        globals.phraseStartTime = this.phraseStartTime;
        globals.sectionStart = this.sectionStart;
        globals.sectionStartTime = this.sectionStartTime;
        globals.sectionEnd = this.sectionEnd;
        globals.tpSec = this.tpSec;
        globals.tpSection = this.tpSection;
        globals.spSection = this.spSection;
        globals.tpPhrase = this.tpPhrase;
        globals.spPhrase = this.spPhrase;
        globals.measureStart = this.measureStart;
        globals.measureStartTime = this.measureStartTime;
        globals.tpMeasure = this.tpMeasure;
        globals.spMeasure = this.spMeasure;
    }
    /**
     * Advance phrase timing.
     */
    advancePhrase(tpPhrase, spPhrase) {
        this.phraseStart += tpPhrase;
        this.phraseStartTime += spPhrase;
        this.tpSection += tpPhrase;
        this.spSection += spPhrase;
    }
    /**
     * Advance section timing.
     */
    advanceSection() {
        this.sectionStart += this.tpSection;
        this.sectionStartTime += this.spSection;
        this.sectionEnd += this.tpSection;
        this.tpSection = 0;
        this.spSection = 0;
    }
}
exports.TimingContext = TimingContext;
// Export to global namespace for backward compatibility
globalThis.TimingContext = TimingContext;
//# sourceMappingURL=TimingContext.js.map