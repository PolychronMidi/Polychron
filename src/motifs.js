"use strict";
// motifs.ts - Motif utilities for interval-based transformations and development.
// minimalist comments, details at: motifs.md
Object.defineProperty(exports, "__esModule", { value: true });
exports.Motif = void 0;
const MATH = Math;
/**
 * Clamp helper to keep MIDI notes in range.
 * @param val - Value to clamp
 * @param min - Minimum value (default: 0)
 * @param max - Maximum value (default: 127)
 * @returns Clamped value
 */
const clampNote = (val, min = 0, max = 127) => MATH.min(max, MATH.max(min, val));
/**
 * Normalize a motif event into { note, duration } shape.
 * @param evt - Event as number or object
 * @param defaultDuration - Default duration if not specified
 * @returns Normalized { note, duration } object
 */
const normalizeEvent = (evt, defaultDuration = 1) => {
    if (evt === null || evt === undefined) {
        return { note: 0, duration: defaultDuration };
    }
    if (typeof evt === 'number') {
        return { note: evt, duration: defaultDuration };
    }
    const note = typeof evt.note === 'number' ? evt.note : 0;
    const duration = typeof evt.duration === 'number' && evt.duration > 0 ? evt.duration : defaultDuration;
    return { note, duration };
};
/**
 * Motif class for melodic transformations and development
 */
class Motif {
    /**
     * Create a new Motif
     * @param sequence - Array of notes or note events
     * @param options - Configuration options
     */
    constructor(sequence = [], options = {}) {
        const { defaultDuration = 1 } = options;
        this.sequence = Array.isArray(sequence)
            ? sequence.map((evt) => normalizeEvent(evt, defaultDuration))
            : [];
        this.defaultDuration = defaultDuration;
    }
    /**
     * Returns a deep-copied sequence.
     * @returns Array of note events
     */
    get events() {
        return this.sequence.map(({ note, duration }) => ({ note, duration }));
    }
    /**
     * Transpose motif by semitones.
     * @param semitones - Number of semitones to transpose
     * @returns New transposed Motif
     */
    transpose(semitones = 0) {
        return new Motif(this.sequence.map(({ note, duration }) => ({
            note: clampNote(note + semitones),
            duration
        })), { defaultDuration: this.defaultDuration });
    }
    /**
     * Invert motif around a pivot (default: first note).
     * @param pivot - Pivot note for inversion (null = use first note)
     * @returns New inverted Motif
     */
    invert(pivot = null) {
        const pivotNote = pivot === null
            ? (this.sequence[0]?.note ?? 0)
            : pivot;
        return new Motif(this.sequence.map(({ note, duration }) => ({
            note: clampNote(pivotNote - (note - pivotNote)),
            duration
        })), { defaultDuration: this.defaultDuration });
    }
    /**
     * Augment durations by factor.
     * @param factor - Multiplication factor
     * @returns New augmented Motif
     */
    augment(factor = 2) {
        const safeFactor = factor <= 0 ? 1 : factor;
        return new Motif(this.sequence.map(({ note, duration }) => ({
            note,
            duration: duration * safeFactor
        })), { defaultDuration: this.defaultDuration * safeFactor });
    }
    /**
     * Diminish durations by factor.
     * @param factor - Division factor
     * @returns New diminished Motif
     */
    diminish(factor = 2) {
        const safeFactor = factor <= 0 ? 1 : factor;
        return new Motif(this.sequence.map(({ note, duration }) => ({
            note,
            duration: duration / safeFactor
        })), { defaultDuration: this.defaultDuration / safeFactor });
    }
    /**
     * Reverse motif order.
     * @returns New reversed Motif
     */
    reverse() {
        return new Motif([...this.sequence].reverse(), { defaultDuration: this.defaultDuration });
    }
    /**
     * Apply a small development chain: transpose, optional inversion, optional reverse, optional scaling.
     * @param options - Development options
     * @returns New developed Motif
     */
    develop(options = {}) {
        const { transposeBy = 12, invertPivot = null, reverse = false, scale = 1 } = options;
        let next = this;
        if (transposeBy !== 0) {
            next = next.transpose(transposeBy);
        }
        if (invertPivot !== false) {
            const pivot = invertPivot;
            next = next.invert(pivot);
        }
        if (reverse) {
            next = next.reverse();
        }
        if (scale !== 1) {
            next = scale > 1 ? next.augment(scale) : next.diminish(1 / scale);
        }
        return next;
    }
    /**
     * Apply motif offsets to an array of note objects (non-mutating).
     * Calculates interval offset from motif's first note and applies to each input note.
     * @param notes - Array of note objects
     * @param options - Clamping options
     * @returns New array of adjusted notes
     */
    applyToNotes(notes = [], options = {}) {
        if (!Array.isArray(notes) || notes.length === 0 || this.sequence.length === 0) {
            return Array.isArray(notes) ? notes : [];
        }
        const { clampMin = 0, clampMax = 127 } = options;
        const baseNote = this.sequence[0].note;
        return notes.map((noteObj, idx) => {
            const motifEvent = this.sequence[idx % this.sequence.length];
            const offset = motifEvent.note - baseNote;
            const newNote = clampNote((noteObj?.note ?? 0) + offset, clampMin, clampMax);
            return { ...noteObj, note: newNote };
        });
    }
}
exports.Motif = Motif;
// Expose motif utilities globally for stage/play integration and testing.
globalThis.Motif = Motif;
globalThis.clampMotifNote = clampNote;
globalThis.activeMotif = globalThis.activeMotif || null;
globalThis.applyMotifToNotes = (notes, motif = globalThis.activeMotif, options = {}) => {
    if (!motif || typeof motif.applyToNotes !== 'function')
        return Array.isArray(notes) ? [...notes] : [];
    return motif.applyToNotes(notes, options);
};
if (typeof globalThis !== 'undefined') {
    globalThis.__POLYCHRON_TEST__ = globalThis.__POLYCHRON_TEST__ || {};
    Object.assign(globalThis.__POLYCHRON_TEST__, {
        Motif,
        clampMotifNote: clampNote,
        applyMotifToNotes: globalThis.applyMotifToNotes,
    });
}
//# sourceMappingURL=motifs.js.map
