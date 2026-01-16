/**
 * @file Type definitions for Polychron music generation system
 * @description JSDoc type definitions for improved type checking
 */

/**
 * @typedef {Object} NoteObject
 * @property {number} note - MIDI note number (0-127)
 * @property {number} [velocity] - Note velocity (0-127)
 * @property {number} [duration] - Note duration in ticks
 * @property {number} [channel] - MIDI channel (0-15)
 */

/**
 * @typedef {Object} MeterConfig
 * @property {number} min - Minimum value
 * @property {number} max - Maximum value
 * @property {number[]} [weights] - Probability weights for weighted random selection
 */

/**
 * @typedef {Object} ScaleInfo
 * @property {string} name - Scale name (e.g., 'major', 'minor')
 * @property {string} root - Root note (e.g., 'C', 'F#')
 * @property {string[]} notes - Array of note names in the scale
 * @property {number[]} intervals - Semitone intervals
 */

/**
 * @typedef {Object} MotifData
 * @property {number[]} intervals - Melodic intervals
 * @property {number[]} durations - Note durations
 * @property {number} [velocity] - Base velocity
 */

/**
 * @typedef {Object} VoiceLeadingOptions
 * @property {number} [smoothness] - Smoothness weight (0-1)
 * @property {number} [parallelPenalty] - Penalty for parallel motion
 * @property {number} [contraryReward] - Reward for contrary motion
 */

/**
 * @typedef {Object} ComposerConfig
 * @property {string} scale - Scale name
 * @property {string} root - Root note
 * @property {number} [octaveMin] - Minimum octave
 * @property {number} [octaveMax] - Maximum octave
 */

/**
 * @typedef {Object} RhythmPattern
 * @property {number[]} onsets - Onset positions (0-1)
 * @property {number} length - Pattern length in beats
 * @property {number} [density] - Note density (0-1)
 */

/**
 * @typedef {Object} FXConfig
 * @property {string} type - Effect type ('reverb', 'delay', 'distortion', etc.)
 * @property {Object} params - Effect parameters
 * @property {number} [wet] - Wet/dry mix (0-1)
 */

/**
 * @typedef {Object} TimingConfig
 * @property {number} bpm - Beats per minute
 * @property {number} [swing] - Swing amount (0-1)
 * @property {number[]} [meter] - Time signature [numerator, denominator]
 */

// Global utility functions

/**
 * Math alias
 * @type {Math}
 */
var m;

/**
 * Clamp value between min and max
 * @type {(value: number, min: number, max: number) => number}
 */
var clamp;

/**
 * Modulo-based clamp with wrapping
 * @type {(value: number, min: number, max: number) => number}
 */
var modClamp;

/**
 * Random float in range
 * @type {(min?: number, max?: number) => number}
 */
var rf;

/**
 * Random float (alias)
 * @type {(min?: number, max?: number) => number}
 */
var randomFloat;

/**
 * Random integer in range
 * @type {(min?: number, max?: number) => number}
 */
var ri;

/**
 * Random integer (alias)
 * @type {(min?: number, max?: number) => number}
 */
var randomInt;

/**
 * Random weighted value in range
 * @type {(min: number, max: number, weights?: number[]) => number}
 */
var rw;

/**
 * Random weighted value (alias)
 * @type {(min: number, max: number, weights?: number[]) => number}
 */
var randomWeightedInRange;

/**
 * Random variation around value
 * @type {(value: number, variation: number) => number}
 */
var rv;

/**
 * Random variation (alias)
 * @type {(value: number, variation: number) => number}
 */
var randomVariation;

/**
 * Random limited change from previous value
 * @type {(prevValue: number, maxChange: number, min?: number, max?: number) => number}
 */
var rl;

/**
 * Random limited change (alias)
 * @type {(prevValue: number, maxChange: number, min?: number, max?: number) => number}
 */
var randomLimitedChange;
