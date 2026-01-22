// sheet.ts - Configuration system - imports from PolychronConfig
// minimalist comments, details at: sheet.md

import {
  type ComposerConfig,
  type RangeConfig,
  type SectionType,
  type BinauralConfig,
  DEFAULT_CONFIG
} from './PolychronConfig.js';

// Re-export all config values from PolychronConfig
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

/**
 * Register sheet-level config values into the DI-friendly PolychronContext.test namespace
 * for legacy tests that still read configuration from a shared namespace. This avoids
 * writing to runtime globals while preserving backwards compatibility for tests.
 *
 * This function requires a PolychronContext instance to be passed in to avoid
 * introducing circular imports. Example:
 *   import PolychronContext from './PolychronContext.js';
 *   registerSheetConfig(PolychronContext);
 *
 * If `assignToState` is true the same values will also be copied into
 * `PolychronContext.state` (useful for test setup when immediate runtime
 * state alignment is needed).
 */
export function registerSheetConfig(poly: any, assignToState = false): void {
  if (!poly) throw new Error('registerSheetConfig requires a PolychronContext instance');
  poly.test = poly.test || {};
  const target: any = assignToState ? (poly.state = poly.state || {}) : poly.test;

  // Lowercase canonical names used across the codebase
  target.numerator = NUMERATOR;
  target.denominator = DENOMINATOR;
  target.divisions = DIVISIONS;
  target.subdivisions = SUBDIVISIONS;
  target.subsubdivs = SUBSUBDIVS;
  target.voices = VOICES;
  target.octave = OCTAVE;
  target.sections = SECTIONS;
  target.phrasesPerSection = PHRASES_PER_SECTION;
  target.sectionTypes = SECTION_TYPES;
  target.bpm = BPM;
  target.ppq = PPQ;
  target.log = LOG;
  target.binaural = BINAURAL;
  target.tuningFreq = TUNING_FREQ;
  target.silentOutroSeconds = SILENT_OUTRO_SECONDS;
  target.composers = COMPOSERS;

  // Legacy uppercase names for any remaining code expecting them
  target.NUMERATOR = NUMERATOR;
  target.DENOMINATOR = DENOMINATOR;
  target.DIVISIONS = DIVISIONS;
  target.SUBDIVISIONS = SUBDIVISIONS;
  target.SUBSUBDIVS = SUBSUBDIVS;
  target.VOICES = VOICES;
  target.OCTAVE = OCTAVE;
  target.SECTIONS = SECTIONS;
  target.PHRASES_PER_SECTION = PHRASES_PER_SECTION;
  target.SECTION_TYPES = SECTION_TYPES;
  target.BPM = BPM;
  target.PPQ = PPQ;
  target.LOG = LOG;
  target.BINAURAL = BINAURAL;
  target.TUNING_FREQ = TUNING_FREQ;
  target.SILENT_OUTRO_SECONDS = SILENT_OUTRO_SECONDS;
  target.COMPOSERS = COMPOSERS;

  // Instruments
  target.primaryInstrument = primaryInstrument;
  target.secondaryInstrument = secondaryInstrument;
  target.otherInstruments = otherInstruments;
  target.bassInstrument = bassInstrument;
  target.bassInstrument2 = bassInstrument2;
  target.otherBassInstruments = otherBassInstruments;
  target.drumSets = drumSets;
}
