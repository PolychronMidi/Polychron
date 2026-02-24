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

// Register existing generator methods into the RhythmRegistry (fail-fast)
RhythmRegistry.register('binary', binary);
RhythmRegistry.register('hex', hex);
RhythmRegistry.register('onsets', onsets);
RhythmRegistry.register('random', random);
RhythmRegistry.register('prob', prob);
RhythmRegistry.register('euclid', euclid);
RhythmRegistry.register('rotate', rotate);
RhythmRegistry.register('morph', morph);
RhythmRegistry.register('closestDivisor', closestDivisor);

// Preserve legacy naked global mapping for backward compatibility
rhythmMethods = RhythmRegistry.getAll();


