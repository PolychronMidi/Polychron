// sheet.ts - Configuration system - imports from PolychronConfig
// minimalist comments, details at: sheet.md

import {
  type ComposerConfig,
  type RangeConfig,
  type SectionType,
  type BinauralConfig,
  DEFAULT_CONFIG
} from './PolychronConfig.js';

// Re-export all config values from PolychronConfig for backward compatibility
export const primaryInstrument = DEFAULT_CONFIG.primaryInstrument;
export const secondaryInstrument = DEFAULT_CONFIG.secondaryInstrument;
export const otherInstruments = DEFAULT_CONFIG.otherInstruments;
export const bassInstrument = DEFAULT_CONFIG.bassInstrument;
export const bassInstrument2 = DEFAULT_CONFIG.bassInstrument2;
export const otherBassInstruments = DEFAULT_CONFIG.otherBassInstruments;
export const drumSets = DEFAULT_CONFIG.drumSets;
export const LOG = DEFAULT_CONFIG.log;
export const TUNING_FREQ = DEFAULT_CONFIG.tuningFreq;
export const BINAURAL = DEFAULT_CONFIG.binaural;
export const PPQ = DEFAULT_CONFIG.ppq;
export const BPM = DEFAULT_CONFIG.bpm;
export const NUMERATOR = DEFAULT_CONFIG.numerator;
export const DENOMINATOR = DEFAULT_CONFIG.denominator;
export const OCTAVE = DEFAULT_CONFIG.octave;
export const VOICES = DEFAULT_CONFIG.voices;
export const SECTION_TYPES = DEFAULT_CONFIG.sectionTypes;
export const PHRASES_PER_SECTION = DEFAULT_CONFIG.phrasesPerSection;
export const SECTIONS = DEFAULT_CONFIG.sections;
export const DIVISIONS = DEFAULT_CONFIG.divisions;
export const SUBDIVISIONS = DEFAULT_CONFIG.subdivisions;
export const SUBSUBDIVS = DEFAULT_CONFIG.subsubdivs;
export const COMPOSERS = DEFAULT_CONFIG.composers;
export const SILENT_OUTRO_SECONDS = DEFAULT_CONFIG.silentOutroSeconds;

// Export to globalThis for backward compatibility
declare global {
  var NUMERATOR: typeof NUMERATOR;
  var DENOMINATOR: typeof DENOMINATOR;
  var DIVISIONS: typeof DIVISIONS;
  var SUBDIVISIONS: typeof SUBDIVISIONS;
  var SUBSUBDIVS: typeof SUBSUBDIVS;
  var VOICES: typeof VOICES;
  var OCTAVE: typeof OCTAVE;
  var SECTIONS: typeof SECTIONS;
  var PHRASES_PER_SECTION: typeof PHRASES_PER_SECTION;
  var SECTION_TYPES: typeof SECTION_TYPES;
  var BPM: number;
  var PPQ: number;
  var LOG: string;
  var BINAURAL: typeof BINAURAL;
  var TUNING_FREQ: number;
  var SILENT_OUTRO_SECONDS: number;
  var COMPOSERS: typeof COMPOSERS;
}

globalThis.NUMERATOR = NUMERATOR;
globalThis.DENOMINATOR = DENOMINATOR;
globalThis.DIVISIONS = DIVISIONS;
globalThis.SUBDIVISIONS = SUBDIVISIONS;
globalThis.SUBSUBDIVS = SUBSUBDIVS;
globalThis.VOICES = VOICES;
globalThis.OCTAVE = OCTAVE;
globalThis.SECTIONS = SECTIONS;
globalThis.PHRASES_PER_SECTION = PHRASES_PER_SECTION;
globalThis.SECTION_TYPES = SECTION_TYPES;
globalThis.BPM = BPM;
globalThis.PPQ = PPQ;
globalThis.LOG = LOG;
globalThis.BINAURAL = BINAURAL;
globalThis.TUNING_FREQ = TUNING_FREQ;
globalThis.SILENT_OUTRO_SECONDS = SILENT_OUTRO_SECONDS;
globalThis.COMPOSERS = COMPOSERS;

// Instrument variables from config
globalThis.primaryInstrument = primaryInstrument;
globalThis.secondaryInstrument = secondaryInstrument;
globalThis.otherInstruments = otherInstruments;
globalThis.bassInstrument = bassInstrument;
globalThis.bassInstrument2 = bassInstrument2;
globalThis.otherBassInstruments = otherBassInstruments;
globalThis.drumSets = drumSets;
