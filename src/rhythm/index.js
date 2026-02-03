require('./drummer');
require('./playDrums');
require('./playDrums2');
require('./makeOnsets');
require('./patternLength');
require('./getRhythm');
require('./setRhythm');
require('./drumMap');
require('./trackRhythm');
require('./patterns');

// Preserve legacy naked globals: modules set these on require side-effect.
// Provide an explicit registry for rhythm method lookup (no runtime code-gen).
rhythmMethods = (typeof rhythmMethods !== 'undefined' && rhythmMethods) ? rhythmMethods : {};
rhythmMethods.binary = binary;
rhythmMethods.hex = hex;
rhythmMethods.onsets = onsets;
rhythmMethods.random = random;
rhythmMethods.prob = prob;
rhythmMethods.euclid = euclid;
rhythmMethods.rotate = rotate;
rhythmMethods.morph = morph;
rhythmMethods.closestDivisor = closestDivisor;
