// Configuration - Global application configuration
import { RandomRange } from './randomRange.js';

export const CONFIG = {
  // MIDI Configuration
  midi: {
    ppq: 30000,
    bpm: 72,
    filename: 'output.csv'
  },

  // Audio Processing Configuration
  audio: {
    tuningFreq: 432,
    binaural: {
      min: 8,
      max: 12
    },
    instruments: {
      primary: 'glockenspiel',
      secondary: 'music box',
      bass: 'Acoustic Bass',
      bass2: 'Synth Bass 2',
      others: [79, 89, 97],
      bassOthers: [32, 33, 34],
      drumSets: [0, 8, 16]
    }
  },

  // Composition Structure
  structure: {
    sections: new RandomRange(6, 9),
    phrasesPerSection: new RandomRange(2, 4)
  },

  // Timing Configuration
  timing: {
    silentOutroSeconds: 5
  },

  // Rhythm Configuration
  rhythm: {
    patterns: {
      'binary': { weights: [2, 3, 1], method: 'binary' },
      'hex': { weights: [2, 3, 1], method: 'hex' },
      'onsets': { weights: [5, 0, 0], method: 'onsets' },
      'onsets2': { weights: [0, 2, 0], method: 'onsets' },
      'onsets3': { weights: [0, 0, 7], method: 'onsets' },
      'random': { weights: [7, 0, 0], method: 'random' },
      'random2': { weights: [0, 3, 0], method: 'random' },
      'random3': { weights: [0, 0, 1], method: 'random' },
      'euclid': { weights: [3, 3, 3], method: 'euclid' },
      'rotate': { weights: [2, 2, 2], method: 'rotate' },
      'morph': { weights: [2, 3, 3], method: 'morph' }
    }
  },

  // Composer Configuration
  composers: [
    {
      type: 'randomScale',
      weight: 2,
      numerator: { min: 2, max: 11, weights: [10, 20, 30, 40, 20, 10, 5, 1] },
      denominator: { min: 3, max: 11, weights: [10, 20, 30, 40, 20, 10, 5, 1] },
      octave: { min: 0, max: 8, weights: [11, 27, 33, 35, 33, 35, 30, 7, 3] },
      voices: { min: 1, max: 7, weights: [15, 30, 25, 7, 4, 3, 2, 1] },
      divisions: { min: 1, max: 10, weights: [1, 15, 20, 25, 20, 10, 10, 7, 2, 2, 1] },
      subdivisions: { min: 1, max: 10, weights: [5, 10, 20, 15, 20, 10, 20, 4, 2, 1] },
      subsubdivs: { min: 1, max: 5, weights: [5, 20, 30, 20, 10, 5] }
    },
    {
      type: 'randomChord',
      weight: 2,
      numerator: { min: 2, max: 11, weights: [10, 20, 30, 40, 20, 10, 5, 1] },
      denominator: { min: 3, max: 11, weights: [10, 20, 30, 40, 20, 10, 5, 1] },
      octave: { min: 0, max: 8, weights: [11, 27, 33, 35, 33, 35, 30, 7, 3] },
      voices: { min: 1, max: 7, weights: [15, 30, 25, 7, 4, 3, 2, 1] },
      divisions: { min: 1, max: 10, weights: [1, 15, 20, 25, 20, 10, 10, 7, 2, 2, 1] },
      subdivisions: { min: 1, max: 10, weights: [5, 10, 20, 15, 20, 10, 20, 4, 2, 1] },
      subsubdivs: { min: 1, max: 5, weights: [5, 20, 30, 20, 10, 5] }
    },
    {
      type: 'randomMode',
      weight: 1,
      numerator: { min: 2, max: 11, weights: [10, 20, 30, 40, 20, 10, 5, 1] },
      denominator: { min: 3, max: 11, weights: [10, 20, 30, 40, 20, 10, 5, 1] },
      octave: { min: 0, max: 8, weights: [11, 27, 33, 35, 33, 35, 30, 7, 3] },
      voices: { min: 1, max: 7, weights: [15, 30, 25, 7, 4, 3, 2, 1] },
      divisions: { min: 1, max: 10, weights: [1, 15, 20, 25, 20, 10, 10, 7, 2, 2, 1] },
      subdivisions: { min: 1, max: 10, weights: [5, 10, 20, 15, 20, 10, 20, 4, 2, 1] },
      subsubdivs: { min: 1, max: 5, weights: [5, 20, 30, 20, 10, 5] }
    }
  ],

  // Logging Configuration
  logging: {
    enabled: true,
    level: 'info',
    logUnits: true
  },

  // Initial State
  initialState: {
    sectionStart: 0,
    sectionStartTime: 0,
    phraseStart: 0,
    phraseStartTime: 0,
    tpSection: 0,
    spSection: 0,
    measureCount: 0,
    beatCount: 0,
    velocity: 99,
    flipBin: false,
    crossModulation: 2.2,
    beatsUntilBinauralShift: 0,
    firstLoop: 0,
    allChannels: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
  }
};