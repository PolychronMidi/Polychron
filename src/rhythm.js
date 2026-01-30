// rhythm.js - Legacy facade (moved to src/rhythm/index.js). Keep this file as a compatibility shim.

// Re-export the modern rhythm implementation and its TestExports
const rhythmExports = require('./rhythm/index');

/* eslint-disable no-restricted-globals */
// Preserve legacy naked globals on the global object (avoids TDZ)
if (typeof globalThis.drummer === 'undefined') globalThis.drummer = rhythmExports.drummer;
if (typeof globalThis.playDrums === 'undefined') globalThis.playDrums = rhythmExports.playDrums;
if (typeof globalThis.playDrums2 === 'undefined') globalThis.playDrums2 = rhythmExports.playDrums2;
if (typeof globalThis.makeOnsets === 'undefined') globalThis.makeOnsets = rhythmExports.makeOnsets;
if (typeof globalThis.patternLength === 'undefined') globalThis.patternLength = rhythmExports.patternLength;
if (typeof globalThis.getRhythm === 'undefined') globalThis.getRhythm = rhythmExports.getRhythm;
if (typeof globalThis.setRhythm === 'undefined') globalThis.setRhythm = rhythmExports.setRhythm;
if (typeof globalThis.drumMap === 'undefined') globalThis.drumMap = rhythmExports.drumMap;
if (typeof globalThis.binary === 'undefined') globalThis.binary = rhythmExports.binary;
if (typeof globalThis.hex === 'undefined') globalThis.hex = rhythmExports.hex;
if (typeof globalThis.onsets === 'undefined') globalThis.onsets = rhythmExports.onsets;
if (typeof globalThis.random === 'undefined') globalThis.random = rhythmExports.random;
if (typeof globalThis.prob === 'undefined') globalThis.prob = rhythmExports.prob;
if (typeof globalThis.euclid === 'undefined') globalThis.euclid = rhythmExports.euclid;
if (typeof globalThis.rotate === 'undefined') globalThis.rotate = rhythmExports.rotate;
if (typeof globalThis.morph === 'undefined') globalThis.morph = rhythmExports.morph;
if (typeof globalThis.closestDivisor === 'undefined') globalThis.closestDivisor = rhythmExports.closestDivisor;
if (typeof globalThis.trackBeatRhythm === 'undefined') globalThis.trackBeatRhythm = rhythmExports.trackBeatRhythm;
if (typeof globalThis.trackDivRhythm === 'undefined') globalThis.trackDivRhythm = rhythmExports.trackDivRhythm;
if (typeof globalThis.trackSubdivRhythm === 'undefined') globalThis.trackSubdivRhythm = rhythmExports.trackSubdivRhythm;
if (typeof globalThis.trackSubsubdivRhythm === 'undefined') globalThis.trackSubsubdivRhythm = rhythmExports.trackSubsubdivRhythm;
/* eslint-enable no-restricted-globals */

/**
 * Rhythm patterns library with weighted selection.
 * @type {Object}
 */
rhythms={
  'binary':{weights:[2,3,1],method:'binary',args:(length)=>[length]},
  'hex':{weights:[2,3,1],method:'hex',args:(length)=>[length]},
  'onsets':{weights:[5,0,0],method:'onsets',args:(length)=>[{make:[length,()=>[1,2]]}]},
  'onsets2':{weights:[0,2,0],method:'onsets',args:(length)=>[{make:[length,[2,3,4]]}]},
  'onsets3':{weights:[0,0,7],method:'onsets',args:(length)=>[{make:[length,()=>[3,7]]}]},
  'random':{weights:[7,0,0],method:'random',args:(length)=>[length,rv(.97,[-.1,.3],.2)]},
  'random2':{weights:[0,3,0],method:'random',args:(length)=>[length,rv(.9,[-.3,.3],.3)]},
  'random3':{weights:[0,0,1],method:'random',args:(length)=>[length,rv(.6,[-.3,.3],.3)]},
  'euclid':{weights:[3,3,3],method:'euclid',args:(length)=>[length,closestDivisor(length,m.ceil(rf(2,length / rf(1,1.2))))]},
  'rotate':{weights:[2,2,2],method:'rotate',args:(length,pattern)=>[pattern,ri(2),'?',length]},
  'morph':{weights:[2,3,3],method:'morph',args:(length,pattern)=>[pattern,'?',length]}
};

// Use extracted patterns implementation
const { binary, hex, onsets, random, prob, euclid, rotate, morph, closestDivisor } = require('./rhythm/patterns');










/**
 * Set rhythm for a given level.
 * @param {string} level - 'beat', 'div', or 'subdiv'.
 * @returns {number[]} Rhythm pattern for the level.
 * @throws {Error} If invalid level provided.
 */
// Use extracted setRhythm implementation
setRhythm = require('./rhythm/setRhythm').setRhythm;

/* Serena: setRhythm extracted to src/rhythm/setRhythm.js */

/**
 * Create custom onsets pattern.
 * @param {number} length - Target length.
 * @param {number|number[]|function} valuesOrRange - Onset values or range.
 * @returns {number[]} Onset pattern.
 */
// Use extracted makeOnsets implementation
makeOnsets = require('./rhythm/makeOnsets').makeOnsets;

/* Serena: makeOnsets extracted to src/rhythm/makeOnsets.js */

/**
 * Adjust pattern to desired length.
 * @param {number[]} pattern - Input pattern.
 * @param {number} [length] - Target length.
 * @returns {number[]} Pattern adjusted to length.
 */
// Use extracted patternLength implementation
patternLength = require('./rhythm/patternLength').patternLength;

/* Serena: patternLength extracted to src/rhythm/patternLength.js */



/**
 * Get rhythm using weighted selection or specific method.
 * @param {string} level - Rhythm level ('beat', 'div', 'subdiv').
 * @param {number} length - Pattern length.
 * @param {number[]} pattern - Current pattern.
 * @param {string} [method] - Specific rhythm method to use.
 * @param {...*} [args] - Arguments for the method.
 * @returns {number[]} Rhythm pattern.
 */
// Use extracted getRhythm implementation
getRhythm = require('./rhythm/getRhythm').getRhythm;

/* Serena: getRhythm extracted to src/rhythm/getRhythm.js */

/**
 * Track beat rhythm state (on/off).
 * @returns {void}
 */


// Re-export the modern rhythm index
module.exports = rhythmExports;
/* Serena: makeOnsets extracted to src/rhythm/makeOnsets.js */
/* Serena: makeOnsets extracted to src/rhythm/makeOnsets.js */
