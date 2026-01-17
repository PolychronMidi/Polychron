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
const g = globalThis as any;
g.NUMERATOR = NUMERATOR;
g.DENOMINATOR = DENOMINATOR;
g.DIVISIONS = DIVISIONS;
g.SUBDIVISIONS = SUBDIVISIONS;
g.SUBSUBDIVS = SUBSUBDIVS;
g.VOICES = VOICES;
g.OCTAVE = OCTAVE;
g.SECTIONS = SECTIONS;
g.PHRASES_PER_SECTION = PHRASES_PER_SECTION;
g.SECTION_TYPES = SECTION_TYPES;
g.BPM = BPM;
g.PPQ = PPQ;
g.LOG = LOG;
g.BINAURAL = BINAURAL;
g.TUNING_FREQ = TUNING_FREQ;
g.SILENT_OUTRO_SECONDS = SILENT_OUTRO_SECONDS;
g.COMPOSERS = COMPOSERS;

// Instrument variables from config
g.primaryInstrument = primaryInstrument;
g.secondaryInstrument = secondaryInstrument;
g.otherInstruments = otherInstruments;
g.bassInstrument = bassInstrument;
g.bassInstrument2 = bassInstrument2;
g.otherBassInstruments = otherBassInstruments;
g.drumSets = drumSets;
