const { drummer } = require('./drummer');
const { playDrums } = require('./playDrums');
const { playDrums2 } = require('./playDrums2');
const { makeOnsets } = require('./makeOnsets');
const { patternLength } = require('./patternLength');
const { getRhythm } = require('./getRhythm');
const { setRhythm } = require('./setRhythm');
const { drumMap } = require('./drumMap');
const { trackRhythm } = require('./trackRhythm');
const { binary, hex, onsets, random, prob, euclid, rotate, morph, closestDivisor } = require('./patterns');

// Individual rhythm modules should be required directly where needed.
// (Avoid exporting a large compatibility bundle; import specific modules instead.)

// Preserve legacy naked globals for backwards compatibility by assigning the local symbols directly to the global object.
/* eslint-disable no-restricted-globals */
if (typeof globalThis.drummer === 'undefined') globalThis.drummer = drummer;
if (typeof globalThis.playDrums === 'undefined') globalThis.playDrums = playDrums;
if (typeof globalThis.playDrums2 === 'undefined') globalThis.playDrums2 = playDrums2;
if (typeof globalThis.makeOnsets === 'undefined') globalThis.makeOnsets = makeOnsets;
if (typeof globalThis.patternLength === 'undefined') globalThis.patternLength = patternLength;
if (typeof globalThis.getRhythm === 'undefined') globalThis.getRhythm = getRhythm;
if (typeof globalThis.setRhythm === 'undefined') globalThis.setRhythm = setRhythm;
if (typeof globalThis.drumMap === 'undefined') globalThis.drumMap = drumMap;
if (typeof globalThis.binary === 'undefined') globalThis.binary = binary;
if (typeof globalThis.hex === 'undefined') globalThis.hex = hex;
if (typeof globalThis.onsets === 'undefined') globalThis.onsets = onsets;
if (typeof globalThis.random === 'undefined') globalThis.random = random;
if (typeof globalThis.prob === 'undefined') globalThis.prob = prob;
if (typeof globalThis.euclid === 'undefined') globalThis.euclid = euclid;
if (typeof globalThis.rotate === 'undefined') globalThis.rotate = rotate;
if (typeof globalThis.morph === 'undefined') globalThis.morph = morph;
if (typeof globalThis.closestDivisor === 'undefined') globalThis.closestDivisor = closestDivisor;
if (typeof globalThis.trackRhythm === 'undefined') globalThis.trackRhythm = trackRhythm;

/* eslint-enable no-restricted-globals */
