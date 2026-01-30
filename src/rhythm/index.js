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
