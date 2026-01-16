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
