// Subsystem helpers (helpers first, manager last)
// @ts-ignore: side-effect module load
require('./RhythmValues');
// @ts-ignore: side-effect module load
require('./rhythmModulator');
// @ts-ignore: side-effect module load
require('./FXFeedbackListener');
// @ts-ignore: side-effect module load
require('./JourneyRhythmCoupler');
// @ts-ignore: side-effect module load
require('./ConductorRegulationListener');
// @ts-ignore: side-effect module load
require('./DrumTextureCoupler');
// @ts-ignore: side-effect module load
require('./PhaseLockedRhythmGenerator');
// @ts-ignore: side-effect module load
require('./rhythmConfig');
// @ts-ignore: side-effect module load
require('./rhythmPriorsData');
// @ts-ignore: side-effect module load
require('./rhythmPriors');
// @ts-ignore: side-effect module load
require('./RhythmRegistry');
// @ts-ignore: side-effect module load
require('./RhythmManager');

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
