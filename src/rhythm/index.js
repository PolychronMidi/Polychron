// Subsystem helpers (helpers first, manager last)
// @ts-ignore: side-effect module load
require('./rhythmValues');
// @ts-ignore: side-effect module load
require('./rhythmModulator');
// @ts-ignore: side-effect module load
require('./feedbackAccumulator');
// @ts-ignore: side-effect module load
require('./fXFeedbackListener');
// @ts-ignore: side-effect module load
require('./stutterFeedbackListener');
// @ts-ignore: side-effect module load
require('./emissionFeedbackListener');
// @ts-ignore: side-effect module load
require('./journeyRhythmCoupler');
// @ts-ignore: side-effect module load
require('./conductorRegulationListener');
// @ts-ignore: side-effect module load
require('./drumTextureCoupler');
// @ts-ignore: side-effect module load
require('./rhythmHistoryTracker');
// @ts-ignore: side-effect module load
require('./phaseLockedRhythmGenerator');
// @ts-ignore: side-effect module load
require('./rhythmConfig');
// @ts-ignore: side-effect module load
require('./rhythmPriorsData');
// @ts-ignore: side-effect module load
require('./rhythmPriors');
// @ts-ignore: side-effect module load
require('./rhythmRegistry');
// @ts-ignore: side-effect module load
require('./rhythmManager');

// Ensure drumMap is loaded before drummer (drummer depends on drumMap internals)
// @ts-ignore: side-effect module load
require('./drumMap');
// @ts-ignore: side-effect module load
require('./drummer');
// @ts-ignore: side-effect module load
require('./playDrums');
// @ts-ignore: side-effect module load
require('./playDrums2');
// @ts-ignore: side-effect module load
require('./makeOnsets');
// @ts-ignore: side-effect module load
require('./patternLength');
// @ts-ignore: side-effect module load
require('./getRhythm');
require('./setRhythm');
// @ts-ignore: side-effect module load
require('./trackRhythm');
require('./patterns');
// @ts-ignore: side-effect module load
require('./crossModulateRhythms');

// Register existing generator methods into the rhythmRegistry (fail-fast)
rhythmRegistry.register('binary', binary);
rhythmRegistry.register('hex', hex);
rhythmRegistry.register('onsets', onsets);
rhythmRegistry.register('random', random);
rhythmRegistry.register('prob', prob);
rhythmRegistry.register('euclid', euclid);
rhythmRegistry.register('rotate', rotate);
rhythmRegistry.register('morph', morph);
rhythmRegistry.register('closestDivisor', closestDivisor);

// Preserve legacy naked global mapping for backward compatibility
rhythmMethods = rhythmRegistry.getAll();


