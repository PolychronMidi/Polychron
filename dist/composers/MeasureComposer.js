"use strict";
// @ts-check
// MeasureComposer - Base class for all composers
// Handles meter composition, note generation, and optional voice leading
/**
 * Composes meter-related values with randomization.
 * @class
 */
class MeasureComposer {
    constructor() {
        /** @type {number[]|null} Previous meter [numerator, denominator] */
        this.lastMeter = null;
        /** @type {number} Recursion depth counter for getNotes */
        this.recursionDepth = 0;
        /** @type {number} Max allowed recursion depth */
        this.MAX_RECURSION = 5;
        /** @type {VoiceLeadingScore|null} Optional voice leading optimizer */
        this.voiceLeading = null;
        /** @type {number[]} Historical notes for voice leading context */
        this.voiceHistory = [];
    }
    /** @returns {number} Random numerator from NUMERATOR config */
    getNumerator() { const { min, max, weights } = NUMERATOR; return m.floor(rw(min, max, weights) * (rf() > 0.5 ? bpmRatio : 1)); }
    /** @returns {number} Random denominator from DENOMINATOR config */
    getDenominator() { const { min, max, weights } = DENOMINATOR; return m.floor(rw(min, max, weights) * (rf() > 0.5 ? bpmRatio : 1)); }
    /** @returns {number} Random divisions count from DIVISIONS config */
    getDivisions() { const { min, max, weights } = DIVISIONS; return m.floor(rw(min, max, weights) * (rf() > 0.5 ? bpmRatio : 1)); }
    /** @returns {number} Random subdivisions count from SUBDIVISIONS config */
    getSubdivisions() { const { min, max, weights } = SUBDIVISIONS; return m.floor(rw(min, max, weights) * (rf() > 0.5 ? bpmRatio : 1)); }
    /** @returns {number} Random sub-subdivisions count from SUBSUBDIVS config */
    getSubsubdivs() { const { min, max, weights } = SUBSUBDIVS; return m.floor(rw(min, max, weights) * (rf() > 0.5 ? bpmRatio : 1)); }
    /** @returns {number} Random voice count from VOICES config */
    getVoices() { const { min, max, weights } = VOICES; return m.floor(rw(min, max, weights) * (rf() > 0.5 ? bpmRatio : 1)); }
    /** @returns {number[]} Two octaves with minimum 2-3 octave difference */
    getOctaveRange() {
        const { min, max, weights } = OCTAVE;
        let [o1, o2] = [rw(min, max, weights), rw(min, max, weights)];
        while (m.abs(o1 - o2) < ri(2, 3)) {
            o2 = modClamp(o2 + ri(-3, 3), min, max);
        }
        return [o1, o2];
    }
    /**
     * Generates a valid meter [numerator, denominator] with log-based ratio check.
     * @param {boolean} [ignoreRatioCheck=false] - Skip ratio validation
     * @param {boolean} [polyMeter=false] - Allow larger ratio jumps for polyrhythm
     * @param {number} [maxIterations=200] - Maximum attempts before fallback
     * @param {number} [timeLimitMs=100] - Maximum wall-clock time before fallback
     * @returns {number[]} [numerator, denominator]
     * @throws {Error} When max iterations exceeded and no valid meter found
     */
    getMeter(ignoreRatioCheck = false, polyMeter = false, maxIterations = 200, timeLimitMs = 100) {
        const METER_RATIO_MIN = 0.25;
        const METER_RATIO_MAX = 4;
        const MIN_LOG_STEPS = 0.5;
        const FALLBACK_METER = [4, 4];
        let iterations = 0;
        const maxLogSteps = polyMeter ? 4 : 2;
        const startTs = Date.now();
        while (++iterations <= maxIterations && (Date.now() - startTs) <= timeLimitMs) {
            let newNumerator = this.getNumerator();
            let newDenominator = this.getDenominator();
            if (!Number.isInteger(newNumerator) || !Number.isInteger(newDenominator) || newNumerator <= 0 || newDenominator <= 0) {
                continue;
            }
            let newMeterRatio = newNumerator / newDenominator;
            const ratioValid = ignoreRatioCheck || (newMeterRatio >= METER_RATIO_MIN && newMeterRatio <= METER_RATIO_MAX);
            if (ratioValid) {
                if (this.lastMeter) {
                    let lastMeterRatio = this.lastMeter[0] / this.lastMeter[1];
                    let logSteps = m.abs(m.log(newMeterRatio / lastMeterRatio) / m.LN2);
                    if (logSteps >= MIN_LOG_STEPS && logSteps <= maxLogSteps) {
                        this.lastMeter = [newNumerator, newDenominator];
                        return this.lastMeter;
                    }
                }
                else {
                    this.lastMeter = [newNumerator, newDenominator];
                    return this.lastMeter;
                }
            }
        }
        console.warn(`getMeter() failed after ${iterations} iterations or ${(Date.now() - startTs)}ms. Ratio bounds: [${METER_RATIO_MIN}, ${METER_RATIO_MAX}]. LogSteps range: [${MIN_LOG_STEPS}, ${maxLogSteps}]. Returning fallback: [${FALLBACK_METER[0]}, ${FALLBACK_METER[1]}]`);
        this.lastMeter = FALLBACK_METER;
        return this.lastMeter;
    }
    /**
     * Generates note objects within octave range.
     * @param {number[]|null} [octaveRange=null] - [min, max] octaves, or auto-generate
     * @returns {{note: number}[]} Array of note objects
     */
    getNotes(octaveRange = null) {
        if (++this.recursionDepth > this.MAX_RECURSION) {
            console.warn('getNotes recursion limit exceeded; returning fallback note 0');
            this.recursionDepth = 0;
            return [{ note: 0 }];
        }
        const uniqueNotes = new Set();
        const voices = this.getVoices();
        const [minOctave, maxOctave] = octaveRange || this.getOctaveRange();
        const rootNote = this.notes[ri(this.notes.length - 1)];
        let intervals = [], fallback = false;
        try {
            const shift = ri();
            switch (ri(2)) {
                case 0:
                    intervals = [0, 2, 3 + shift, 6 - shift].map(interval => clamp(interval * m.round(this.notes.length / 7), 0, this.notes.length - 1));
                    break;
                case 1:
                    intervals = [0, 1, 3 + shift, 5 + shift].map(interval => clamp(interval * m.round(this.notes.length / 7), 0, this.notes.length - 1));
                    break;
                default:
                    intervals = Array.from({ length: this.notes.length }, (_, i) => i);
                    fallback = true;
            }
            intervals = intervals.map(interval => {
                const validatedInterval = clamp(interval, 0, this.notes.length - 1);
                const rootIndex = this.notes.indexOf(rootNote);
                const noteIndex = (rootIndex + validatedInterval) % this.notes.length;
                return validatedInterval;
            });
            return intervals.slice(0, voices).map((interval, index) => {
                const noteIndex = (this.notes.indexOf(rootNote) + interval) % this.notes.length;
                let octave = ri(minOctave, maxOctave);
                let note = t.Note.chroma(this.notes[noteIndex]) + 12 * octave;
                while (uniqueNotes.has(note)) {
                    octave = octave < maxOctave ? octave++ : octave > minOctave ? octave-- : octave < OCTAVE.max ? octave++ : octave > OCTAVE.min ? octave-- : (() => { return false; })();
                    if (octave === false)
                        break;
                    note = t.Note.chroma(this.notes[noteIndex]) + 12 * octave;
                }
                return { note };
            }).filter((noteObj, index, self) => index === self.findIndex(n => n.note === noteObj.note));
        }
        catch (e) {
            if (!fallback) {
                this.recursionDepth--;
                return this.getNotes(octaveRange);
            }
            else {
                console.warn(e.message);
                this.recursionDepth--;
                return this.getNotes(octaveRange);
            }
        }
        finally {
            this.recursionDepth--;
        }
    }
    /**
     * Enables voice leading optimization for this composer.
     * @param {VoiceLeadingScore} [scorer] - Optional custom voice leading scorer
     * @returns {void}
     */
    enableVoiceLeading(scorer) {
        this.voiceLeading = scorer || new VoiceLeadingScore();
        this.voiceHistory = [];
    }
    /**
     * Disables voice leading optimization.
     * @returns {void}
     */
    disableVoiceLeading() {
        this.voiceLeading = null;
        this.voiceHistory = [];
    }
    /**
     * Selects the best note from available candidates using voice leading cost function.
     * Falls back to random selection if voice leading is disabled.
     * @param {number[]} availableNotes - Pool of candidate notes
     * @param {{ register?: string, constraints?: string[] }} [config] - Voice context
     * @returns {number} Selected note
     */
    selectNoteWithLeading(availableNotes, config = {}) {
        if (!this.voiceLeading || !availableNotes || availableNotes.length === 0) {
            return availableNotes?.[ri(availableNotes.length - 1)] ?? 60;
        }
        const selectedNote = this.voiceLeading.selectNextNote(this.voiceHistory, availableNotes, config);
        this.voiceHistory.push(selectedNote);
        if (this.voiceHistory.length > 4) {
            this.voiceHistory.shift();
        }
        return selectedNote;
    }
    /**
     * Resets voice leading history (call at section boundaries).
     * @returns {void}
     */
    resetVoiceLeading() {
        this.voiceHistory = [];
        if (this.voiceLeading) {
            this.voiceLeading.reset();
        }
    }
}
//# sourceMappingURL=MeasureComposer.js.map
