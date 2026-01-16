"use strict";
// sheet.ts - Configuration system with musical parameters and structural settings.
// minimalist comments, details at: sheet.md
Object.defineProperty(exports, "__esModule", { value: true });
exports.SILENT_OUTRO_SECONDS = exports.COMPOSERS = exports.SUBSUBDIVS = exports.SUBDIVISIONS = exports.DIVISIONS = exports.SECTIONS = exports.PHRASES_PER_SECTION = exports.SECTION_TYPES = exports.VOICES = exports.OCTAVE = exports.DENOMINATOR = exports.NUMERATOR = exports.BPM = exports.PPQ = exports.BINAURAL = exports.TUNING_FREQ = exports.LOG = exports.drumSets = exports.otherBassInstruments = exports.bassInstrument2 = exports.bassInstrument = exports.otherInstruments = exports.secondaryInstrument = exports.primaryInstrument = void 0;
// Primary instrument selection
exports.primaryInstrument = 'glockenspiel';
// Secondary instrument selection
exports.secondaryInstrument = 'music box';
// Array of MIDI program numbers for secondary/tertiary instruments
exports.otherInstruments = [9, 10, 11, 12, 13, 14, 79, 89, 97, 98, 98, 98, 104, 112, 114, 119, 120, 121];
// Bass instrument selection
exports.bassInstrument = 'Acoustic Bass';
// Secondary bass instrument selection
exports.bassInstrument2 = 'Synth Bass 2';
// Array of MIDI program numbers for bass instruments
exports.otherBassInstruments = [32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 43, 44, 45, 46, 48, 49, 50, 51, 89, 98, 98, 98, 98, 98, 98, 98, 98, 98, 98];
// MIDI drum set program numbers (all on channel 9)
exports.drumSets = [0, 8, 16, 24, 25, 32, 40, 48, 127];
// Logging configuration: which units to log (comma-separated)
exports.LOG = 'section,phrase,measure';
// Tuning frequency in Hz for binaural beats
exports.TUNING_FREQ = 432;
// Binaural beat frequency range
exports.BINAURAL = {
    min: 8,
    max: 12
};
// MIDI pulses per quarter note (resolution)
exports.PPQ = 30000;
// Tempo in beats per minute
exports.BPM = 72;
// Numerator range for meter generation
exports.NUMERATOR = {
    min: 2,
    max: 20,
    weights: [10, 20, 30, 40, 20, 10, 5, 1]
};
// Denominator range for meter generation
exports.DENOMINATOR = {
    min: 3,
    max: 20,
    weights: [10, 20, 30, 40, 20, 10, 5, 1]
};
// Octave range for note generation
exports.OCTAVE = {
    min: 0,
    max: 8,
    weights: [11, 27, 33, 35, 33, 35, 30, 7, 3]
};
// Number of voices (polyphony level)
exports.VOICES = {
    min: 1,
    max: 7,
    weights: [15, 30, 25, 7, 4, 3, 2, 1]
};
// Section types with structural parameters
exports.SECTION_TYPES = [
    { type: 'intro', weight: 2, phrases: { min: 1, max: 2 }, bpmScale: 0.9, dynamics: 'pp', motif: [0, 2, 4, 7] },
    { type: 'exposition', weight: 3, phrases: { min: 2, max: 3 }, bpmScale: 1, dynamics: 'mf', motif: [0, 4, 7, 12] },
    { type: 'development', weight: 2, phrases: { min: 3, max: 4 }, bpmScale: 1.05, dynamics: 'f', motif: [0, 3, 5, 8, 10] },
    { type: 'conclusion', weight: 2, phrases: { min: 1, max: 2 }, bpmScale: 0.95, dynamics: 'p', motif: [0, 5, 7, 12] },
    { type: 'coda', weight: 1, phrases: { min: 1, max: 1 }, bpmScale: 0.9, dynamics: 'pp', motif: [0, 7, 12] }
];
// Phrases per section range
exports.PHRASES_PER_SECTION = {
    min: 2,
    max: 4
};
// Total sections range
exports.SECTIONS = {
    min: 6,
    max: 9
};
// Divisions (of beat) range
exports.DIVISIONS = {
    min: 0,
    max: 10,
    weights: [1, 15, 20, 25, 20, 10, 10, 7, 2, 2, 1]
};
// Subdivisions (of division) range
exports.SUBDIVISIONS = {
    min: 0,
    max: 10,
    weights: [5, 10, 20, 15, 20, 10, 20, 4, 2, 1]
};
// Sub-subdivisions (of subdivision) range
exports.SUBSUBDIVS = {
    min: 0,
    max: 5,
    weights: [5, 20, 30, 20, 10, 5]
};
// Composer configurations for generation
exports.COMPOSERS = [
    { type: 'scale', name: 'major', root: 'C' },
    { type: 'chords', progression: ['Cmaj7', 'Dm', 'G', 'Cmaj7'] },
    { type: 'mode', name: 'ionian', root: 'C' },
    { type: 'scale', name: 'random', root: 'C' },
    { type: 'scale', name: 'major', root: 'random' },
    { type: 'chords', progression: 'random' },
    { type: 'mode', name: 'ionian', root: 'random' },
    { type: 'mode', name: 'random', root: 'random' },
    { type: 'pentatonic', root: 'C', scaleType: 'major' },
    { type: 'pentatonic', root: 'random', scaleType: 'random' },
    { type: 'tensionRelease', quality: 'major', tensionCurve: 0.6 },
    { type: 'modalInterchange', primaryMode: 'major', borrowProbability: 0.3 },
    // Melodic Development Composers (Phase 2.3)
    { type: 'melodicDevelopment', name: 'major', root: 'C', developmentIntensity: 0.6 },
    { type: 'melodicDevelopment', name: 'major', root: 'C', developmentIntensity: 0.4 },
    { type: 'melodicDevelopment', name: 'random', root: 'random', developmentIntensity: 0.5 },
    { type: 'melodicDevelopment', name: 'random', root: 'random', developmentIntensity: 0.7 },
    // Advanced Voice Leading Composers (Phase 2.4)
    { type: 'advancedVoiceLeading', name: 'major', root: 'C', commonToneWeight: 0.7 },
    { type: 'advancedVoiceLeading', name: 'major', root: 'C', commonToneWeight: 0.5 },
    { type: 'advancedVoiceLeading', name: 'random', root: 'random', commonToneWeight: 0.6 },
    { type: 'advancedVoiceLeading', name: 'random', root: 'random', commonToneWeight: 0.8 },
    // Harmonic Rhythm (limited to avoid too many drums)
    { type: 'harmonicRhythm', progression: ['I', 'IV', 'V', 'I'], key: 'random', measuresPerChord: 2, quality: 'major' }
];
// Silent outro duration in seconds
exports.SILENT_OUTRO_SECONDS = 5;
// Export all to global scope for backward compatibility
globalThis.primaryInstrument = exports.primaryInstrument;
globalThis.secondaryInstrument = exports.secondaryInstrument;
globalThis.otherInstruments = exports.otherInstruments;
globalThis.bassInstrument = exports.bassInstrument;
globalThis.bassInstrument2 = exports.bassInstrument2;
globalThis.otherBassInstruments = exports.otherBassInstruments;
globalThis.drumSets = exports.drumSets;
globalThis.LOG = exports.LOG;
globalThis.TUNING_FREQ = exports.TUNING_FREQ;
globalThis.BINAURAL = exports.BINAURAL;
globalThis.PPQ = exports.PPQ;
globalThis.BPM = exports.BPM;
globalThis.NUMERATOR = exports.NUMERATOR;
globalThis.DENOMINATOR = exports.DENOMINATOR;
globalThis.OCTAVE = exports.OCTAVE;
globalThis.VOICES = exports.VOICES;
globalThis.SECTION_TYPES = exports.SECTION_TYPES;
globalThis.PHRASES_PER_SECTION = exports.PHRASES_PER_SECTION;
globalThis.SECTIONS = exports.SECTIONS;
globalThis.DIVISIONS = exports.DIVISIONS;
globalThis.SUBDIVISIONS = exports.SUBDIVISIONS;
globalThis.SUBSUBDIVS = exports.SUBSUBDIVS;
globalThis.COMPOSERS = exports.COMPOSERS;
globalThis.SILENT_OUTRO_SECONDS = exports.SILENT_OUTRO_SECONDS;
// Export for tests
if (typeof globalThis !== 'undefined') {
    globalThis.__POLYCHRON_TEST__ = globalThis.__POLYCHRON_TEST__ || {};
    Object.assign(globalThis.__POLYCHRON_TEST__, {
        primaryInstrument: exports.primaryInstrument,
        secondaryInstrument: exports.secondaryInstrument,
        otherInstruments: exports.otherInstruments,
        bassInstrument: exports.bassInstrument,
        bassInstrument2: exports.bassInstrument2,
        otherBassInstruments: exports.otherBassInstruments,
        drumSets: exports.drumSets,
        LOG: exports.LOG,
        TUNING_FREQ: exports.TUNING_FREQ,
        BINAURAL: exports.BINAURAL,
        PPQ: exports.PPQ,
        BPM: exports.BPM,
        NUMERATOR: exports.NUMERATOR,
        DENOMINATOR: exports.DENOMINATOR,
        OCTAVE: exports.OCTAVE,
        VOICES: exports.VOICES,
        SECTION_TYPES: exports.SECTION_TYPES,
        PHRASES_PER_SECTION: exports.PHRASES_PER_SECTION,
        SECTIONS: exports.SECTIONS,
        DIVISIONS: exports.DIVISIONS,
        SUBDIVISIONS: exports.SUBDIVISIONS,
        SUBSUBDIVS: exports.SUBSUBDIVS,
        COMPOSERS: exports.COMPOSERS,
        SILENT_OUTRO_SECONDS: exports.SILENT_OUTRO_SECONDS
    });
}
//# sourceMappingURL=sheet.js.map
