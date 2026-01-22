// PolychronConfig.ts - Centralized configuration system for Polychron composition engine
// All musical parameters, timing, and instrument settings managed in one place

/**
 * Composer configuration object
 */
export interface ComposerConfig {
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
export interface RangeConfig {
  min: number;
  max: number;
  weights?: number[];
}

/**
 * Section type configuration
 */
export interface SectionType {
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
export interface BinauralConfig {
  min: number;
  max: number;
}

/**
 * Main Polychron configuration interface
 */
export interface PolychronConfig {
  // Instruments
  primaryInstrument: string;
  secondaryInstrument: string;
  otherInstruments: number[];
  bassInstrument: string;
  bassInstrument2: string;
  otherBassInstruments: number[];
  drumSets: number[];

  // Logging and tuning
  log: string;
  tuningFreq: number;
  binaural: BinauralConfig;

  // Timing and MIDI
  ppq: number; // Pulses per quarter note
  bpm: number; // Beats per minute

  // Musical parameters
  numerator: RangeConfig;
  denominator: RangeConfig;
  octave: RangeConfig;
  voices: RangeConfig;
  divisions: RangeConfig;
  subdivisions: RangeConfig;
  subsubdivs: RangeConfig;

  // Structure
  sectionTypes: SectionType[];
  phrasesPerSection: RangeConfig;
  sections: RangeConfig;

  // Composers
  composers: ComposerConfig[];

  // Output
  silentOutroSeconds: number;
}

/**
 * Default configuration - all values from sheet.ts
 */
export const DEFAULT_CONFIG: PolychronConfig = {
  // Instruments
  primaryInstrument: 'glockenspiel',
  secondaryInstrument: 'music box',
  otherInstruments: [9, 10, 11, 12, 13, 14, 79, 89, 97, 98, 98, 98, 104, 112, 114, 119, 120, 121],
  bassInstrument: 'Acoustic Bass',
  bassInstrument2: 'Synth Bass 2',
  otherBassInstruments: [32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 43, 44, 45, 46, 48, 49, 50, 51, 89, 98, 98, 98, 98, 98, 98, 98, 98, 98, 98],
  drumSets: [0, 8, 16, 24, 25, 32, 40, 48, 127],

  // Logging and tuning
  log: 'section,phrase,measure',
  tuningFreq: 432,
  binaural: {
    min: 8,
    max: 12
  },

  // Timing and MIDI
  ppq: 480,
  bpm: 72,

  // Musical parameters
  numerator: {
    min: 2,
    max: 20,
    weights: [10, 20, 30, 40, 20, 10, 5, 1]
  },
  denominator: {
    min: 3,
    max: 20,
    weights: [10, 20, 30, 40, 20, 10, 5, 1]
  },
  octave: {
    min: 0,
    max: 8,
    weights: [11, 27, 33, 35, 33, 35, 30, 7, 3]
  },
  voices: {
    min: 1,
    max: 7,
    weights: [15, 30, 25, 7, 4, 3, 2, 1]
  },
  divisions: {
    min: 0,
    max: 10,
    weights: [1, 15, 20, 25, 20, 10, 10, 7, 2, 2, 1]
  },
  subdivisions: {
    min: 0,
    max: 10,
    weights: [5, 10, 20, 15, 20, 10, 20, 4, 2, 1]
  },
  subsubdivs: {
    min: 0,
    max: 5,
    weights: [5, 20, 30, 20, 10, 5]
  },

  // Structure
  sectionTypes: [
    { type: 'intro', weight: 2, phrases: { min: 1, max: 2 }, bpmScale: 0.9, dynamics: 'pp', motif: [0, 2, 4, 7] },
    { type: 'exposition', weight: 3, phrases: { min: 2, max: 3 }, bpmScale: 1, dynamics: 'mf', motif: [0, 4, 7, 12] },
    { type: 'development', weight: 2, phrases: { min: 3, max: 4 }, bpmScale: 1.05, dynamics: 'f', motif: [0, 3, 5, 8, 10] },
    { type: 'conclusion', weight: 2, phrases: { min: 1, max: 2 }, bpmScale: 0.95, dynamics: 'p', motif: [0, 5, 7, 12] },
    { type: 'coda', weight: 1, phrases: { min: 1, max: 1 }, bpmScale: 0.9, dynamics: 'pp', motif: [0, 7, 12] }
  ],
  phrasesPerSection: {
    min: 2,
    max: 4
  },
  sections: {
    min: 6,
    max: 9
  },

  // Composers
  composers: [
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
    { type: 'melodicDevelopment', name: 'major', root: 'C', developmentIntensity: 0.6 },
    { type: 'melodicDevelopment', name: 'major', root: 'C', developmentIntensity: 0.4 },
    { type: 'melodicDevelopment', name: 'random', root: 'random', developmentIntensity: 0.5 },
    { type: 'melodicDevelopment', name: 'random', root: 'random', developmentIntensity: 0.7 },
    { type: 'advancedVoiceLeading', name: 'major', root: 'C', commonToneWeight: 0.7 },
    { type: 'advancedVoiceLeading', name: 'major', root: 'C', commonToneWeight: 0.5 },
    { type: 'advancedVoiceLeading', name: 'random', root: 'random', commonToneWeight: 0.6 },
    { type: 'advancedVoiceLeading', name: 'random', root: 'random', commonToneWeight: 0.8 },
    { type: 'harmonicRhythm', progression: ['I', 'IV', 'V', 'I'], key: 'random', measuresPerChord: 2, quality: 'major' }
  ],

  // Output
  silentOutroSeconds: 5
};

/**
 * Validate config values are within acceptable ranges
 */
export function validateConfig(config: PolychronConfig): string[] {
  const errors: string[] = [];

  // Validate timing
  if (config.ppq < 100 || config.ppq > 1000000) errors.push('ppq must be between 100 and 1000000');
  if (config.bpm < 20 || config.bpm > 300) errors.push('bpm must be between 20 and 300');

  // Validate tuning
  if (config.tuningFreq < 40 || config.tuningFreq > 2000) errors.push('tuningFreq must be between 40 and 2000 Hz');
  if (config.binaural.min < 1 || config.binaural.max > 40) errors.push('binaural frequency must be between 1 and 40 Hz');
  if (config.binaural.min >= config.binaural.max) errors.push('binaural.min must be less than binaural.max');

  // Validate ranges
  const ranges: Array<[string, RangeConfig]> = [
    ['numerator', config.numerator],
    ['denominator', config.denominator],
    ['octave', config.octave],
    ['voices', config.voices],
    ['divisions', config.divisions],
    ['subdivisions', config.subdivisions],
    ['subsubdivs', config.subsubdivs],
    ['phrasesPerSection', config.phrasesPerSection],
    ['sections', config.sections]
  ];

  ranges.forEach(([name, range]) => {
    if (range.min < 0) errors.push(`${name}.min must be non-negative`);
    if (range.max < range.min) errors.push(`${name}.max must be >= ${name}.min`);
    if (range.weights && range.weights.length !== (range.max - range.min + 1)) {
      errors.push(`${name}.weights length (${range.weights.length}) must match range size (${range.max - range.min + 1})`);
    }
  });

  // Validate silentOutroSeconds
  if (config.silentOutroSeconds < 0 || config.silentOutroSeconds > 60) {
    errors.push('silentOutroSeconds must be between 0 and 60');
  }

  return errors;
}

/**
 * Load config from file or use defaults
 */
export function loadConfig(filePath?: string): PolychronConfig {
  // For now, always return default config
  // In future, this could load from JSON file if filePath provided
  const config = { ...DEFAULT_CONFIG };

  // Validate loaded config
  const errors = validateConfig(config);
  if (errors.length > 0) {
    console.warn('Config validation errors:', errors);
  }

  return config;
}

/**
 * Global config instance
 */
let globalConfig: PolychronConfig = DEFAULT_CONFIG;

/**
 * Get current global config
 */
export function getConfig(): PolychronConfig {
  return globalConfig;
}

/**
 * Set global config (mainly for testing)
 */
export function setConfig(config: PolychronConfig): void {
  const errors = validateConfig(config);
  if (errors.length > 0) {
    throw new Error(`Invalid config: ${errors.join(', ')}`);
  }
  globalConfig = config;
}

/**
 * Reset to default config
 */
export function resetConfig(): void {
  globalConfig = { ...DEFAULT_CONFIG };
}



export default DEFAULT_CONFIG;
