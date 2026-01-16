// sheet.ts - Configuration system with musical parameters and structural settings.
// minimalist comments, details at: sheet.md

/**
 * Composer configuration object
 */
interface ComposerConfig {
  type: string;
  name?: string;
  root?: string;
  scale?: any;
  progression?: string[] | string;
  motif?: number[];
  weight?: number;
  phrases?: any;
  bpmScale?: number;
  dynamics?: string;
  scaleType?: string;
  quality?: string;
  tensionCurve?: number;
  primaryMode?: string;
  borrowProbability?: number;
  developmentIntensity?: number;
  commonToneWeight?: number;
  measuresPerChord?: number;
  key?: string;
}

/**
 * Range configuration with optional weights
 */
interface RangeConfig {
  min: number;
  max: number;
  weights?: number[];
}

/**
 * Section type configuration
 */
interface SectionType {
  type: string;
  weight: number;
  phrases: { min: number; max: number };
  bpmScale: number;
  dynamics: string;
  motif: number[];
}

/**
 * Binaural configuration
 */
interface BinauralConfig {
  min: number;
  max: number;
}

// Primary instrument selection
export const primaryInstrument: string = 'glockenspiel';

// Secondary instrument selection
export const secondaryInstrument: string = 'music box';

// Array of MIDI program numbers for secondary/tertiary instruments
export const otherInstruments: number[] = [9, 10, 11, 12, 13, 14, 79, 89, 97, 98, 98, 98, 104, 112, 114, 119, 120, 121];

// Bass instrument selection
export const bassInstrument: string = 'Acoustic Bass';

// Secondary bass instrument selection
export const bassInstrument2: string = 'Synth Bass 2';

// Array of MIDI program numbers for bass instruments
export const otherBassInstruments: number[] = [32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 43, 44, 45, 46, 48, 49, 50, 51, 89, 98, 98, 98, 98, 98, 98, 98, 98, 98, 98];

// MIDI drum set program numbers (all on channel 9)
export const drumSets: number[] = [0, 8, 16, 24, 25, 32, 40, 48, 127];

// Logging configuration: which units to log (comma-separated)
export const LOG: string = 'section,phrase,measure';

// Tuning frequency in Hz for binaural beats
export const TUNING_FREQ: number = 432;

// Binaural beat frequency range
export const BINAURAL: BinauralConfig = {
  min: 8,
  max: 12
};

// MIDI pulses per quarter note (resolution)
export const PPQ: number = 30000;

// Tempo in beats per minute
export const BPM: number = 72;

// Numerator range for meter generation
export const NUMERATOR: RangeConfig = {
  min: 2,
  max: 20,
  weights: [10, 20, 30, 40, 20, 10, 5, 1]
};

// Denominator range for meter generation
export const DENOMINATOR: RangeConfig = {
  min: 3,
  max: 20,
  weights: [10, 20, 30, 40, 20, 10, 5, 1]
};

// Octave range for note generation
export const OCTAVE: RangeConfig = {
  min: 0,
  max: 8,
  weights: [11, 27, 33, 35, 33, 35, 30, 7, 3]
};

// Number of voices (polyphony level)
export const VOICES: RangeConfig = {
  min: 1,
  max: 7,
  weights: [15, 30, 25, 7, 4, 3, 2, 1]
};

// Section types with structural parameters
export const SECTION_TYPES: SectionType[] = [
  { type: 'intro', weight: 2, phrases: { min: 1, max: 2 }, bpmScale: 0.9, dynamics: 'pp', motif: [0, 2, 4, 7] },
  { type: 'exposition', weight: 3, phrases: { min: 2, max: 3 }, bpmScale: 1, dynamics: 'mf', motif: [0, 4, 7, 12] },
  { type: 'development', weight: 2, phrases: { min: 3, max: 4 }, bpmScale: 1.05, dynamics: 'f', motif: [0, 3, 5, 8, 10] },
  { type: 'conclusion', weight: 2, phrases: { min: 1, max: 2 }, bpmScale: 0.95, dynamics: 'p', motif: [0, 5, 7, 12] },
  { type: 'coda', weight: 1, phrases: { min: 1, max: 1 }, bpmScale: 0.9, dynamics: 'pp', motif: [0, 7, 12] }
];

// Phrases per section range
export const PHRASES_PER_SECTION: RangeConfig = {
  min: 2,
  max: 4
};

// Total sections range
export const SECTIONS: RangeConfig = {
  min: 6,
  max: 9
};

// Divisions (of beat) range
export const DIVISIONS: RangeConfig = {
  min: 0,
  max: 10,
  weights: [1, 15, 20, 25, 20, 10, 10, 7, 2, 2, 1]
};

// Subdivisions (of division) range
export const SUBDIVISIONS: RangeConfig = {
  min: 0,
  max: 10,
  weights: [5, 10, 20, 15, 20, 10, 20, 4, 2, 1]
};

// Sub-subdivisions (of subdivision) range
export const SUBSUBDIVS: RangeConfig = {
  min: 0,
  max: 5,
  weights: [5, 20, 30, 20, 10, 5]
};

// Composer configurations for generation
export const COMPOSERS: ComposerConfig[] = [
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
export const SILENT_OUTRO_SECONDS: number = 5;

// Export all to global scope for backward compatibility
(globalThis as any).primaryInstrument = primaryInstrument;
(globalThis as any).secondaryInstrument = secondaryInstrument;
(globalThis as any).otherInstruments = otherInstruments;
(globalThis as any).bassInstrument = bassInstrument;
(globalThis as any).bassInstrument2 = bassInstrument2;
(globalThis as any).otherBassInstruments = otherBassInstruments;
(globalThis as any).drumSets = drumSets;
(globalThis as any).LOG = LOG;
(globalThis as any).TUNING_FREQ = TUNING_FREQ;
(globalThis as any).BINAURAL = BINAURAL;
(globalThis as any).PPQ = PPQ;
(globalThis as any).BPM = BPM;
(globalThis as any).NUMERATOR = NUMERATOR;
(globalThis as any).DENOMINATOR = DENOMINATOR;
(globalThis as any).OCTAVE = OCTAVE;
(globalThis as any).VOICES = VOICES;
(globalThis as any).SECTION_TYPES = SECTION_TYPES;
(globalThis as any).PHRASES_PER_SECTION = PHRASES_PER_SECTION;
(globalThis as any).SECTIONS = SECTIONS;
(globalThis as any).DIVISIONS = DIVISIONS;
(globalThis as any).SUBDIVISIONS = SUBDIVISIONS;
(globalThis as any).SUBSUBDIVS = SUBSUBDIVS;
(globalThis as any).COMPOSERS = COMPOSERS;
(globalThis as any).SILENT_OUTRO_SECONDS = SILENT_OUTRO_SECONDS;

// Export for tests
if (typeof globalThis !== 'undefined') {
  (globalThis as any).__POLYCHRON_TEST__ = (globalThis as any).__POLYCHRON_TEST__ || {};
  Object.assign((globalThis as any).__POLYCHRON_TEST__, {
    primaryInstrument,
    secondaryInstrument,
    otherInstruments,
    bassInstrument,
    bassInstrument2,
    otherBassInstruments,
    drumSets,
    LOG,
    TUNING_FREQ,
    BINAURAL,
    PPQ,
    BPM,
    NUMERATOR,
    DENOMINATOR,
    OCTAVE,
    VOICES,
    SECTION_TYPES,
    PHRASES_PER_SECTION,
    SECTIONS,
    DIVISIONS,
    SUBDIVISIONS,
    SUBSUBDIVS,
    COMPOSERS,
    SILENT_OUTRO_SECONDS
  });
}
