const { drummer } = require('./drummer');
const { playDrums } = require('./playDrums');
const { playDrums2 } = require('./playDrums2');
const { makeOnsets } = require('./makeOnsets');
const { patternLength } = require('./patternLength');
const { getRhythm } = require('./getRhythm');
const { setRhythm } = require('./setRhythm');
const { drumMap } = require('./drumMap');
const { trackBeatRhythm, trackDivRhythm, trackSubdivRhythm, trackSubsubdivRhythm } = require('./trackRhythm');
const { binary, hex, onsets, random, prob, euclid, rotate, morph, closestDivisor } = require('./patterns');

const TestExports = {
  drummer,
  playDrums,
  playDrums2,
  makeOnsets,
  patternLength,
  getRhythm,
  setRhythm,
  drumMap,
  trackBeatRhythm,
  trackDivRhythm,
  trackSubdivRhythm,
  trackSubsubdivRhythm,
  binary,
  hex,
  onsets,
  random,
  prob,
  euclid,
  rotate,
  morph,
  closestDivisor
};

try {
  module.exports = Object.assign({ TestExports }, TestExports);
} catch (e) { /* swallow */ }

// Preserve legacy naked globals for backwards compatibility
/* eslint-disable no-restricted-globals */
if (typeof globalThis.drummer === 'undefined') globalThis.drummer = module.exports.drummer;
if (typeof globalThis.playDrums === 'undefined') globalThis.playDrums = module.exports.playDrums;
if (typeof globalThis.playDrums2 === 'undefined') globalThis.playDrums2 = module.exports.playDrums2;
if (typeof globalThis.makeOnsets === 'undefined') globalThis.makeOnsets = module.exports.makeOnsets;
if (typeof globalThis.patternLength === 'undefined') globalThis.patternLength = module.exports.patternLength;
if (typeof globalThis.getRhythm === 'undefined') globalThis.getRhythm = module.exports.getRhythm;
if (typeof globalThis.setRhythm === 'undefined') globalThis.setRhythm = module.exports.setRhythm;
if (typeof globalThis.drumMap === 'undefined') globalThis.drumMap = module.exports.drumMap;
if (typeof globalThis.binary === 'undefined') globalThis.binary = module.exports.binary;
if (typeof globalThis.hex === 'undefined') globalThis.hex = module.exports.hex;
if (typeof globalThis.onsets === 'undefined') globalThis.onsets = module.exports.onsets;
if (typeof globalThis.random === 'undefined') globalThis.random = module.exports.random;
if (typeof globalThis.prob === 'undefined') globalThis.prob = module.exports.prob;
if (typeof globalThis.euclid === 'undefined') globalThis.euclid = module.exports.euclid;
if (typeof globalThis.rotate === 'undefined') globalThis.rotate = module.exports.rotate;
if (typeof globalThis.morph === 'undefined') globalThis.morph = module.exports.morph;
if (typeof globalThis.closestDivisor === 'undefined') globalThis.closestDivisor = module.exports.closestDivisor;
if (typeof globalThis.trackBeatRhythm === 'undefined') globalThis.trackBeatRhythm = module.exports.trackBeatRhythm;
if (typeof globalThis.trackDivRhythm === 'undefined') globalThis.trackDivRhythm = module.exports.trackDivRhythm;
if (typeof globalThis.trackSubdivRhythm === 'undefined') globalThis.trackSubdivRhythm = module.exports.trackSubdivRhythm;
if (typeof globalThis.trackSubsubdivRhythm === 'undefined') globalThis.trackSubsubdivRhythm = module.exports.trackSubsubdivRhythm;
/* eslint-enable no-restricted-globals */
