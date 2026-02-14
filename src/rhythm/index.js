// Subsystem helpers (helpers first, manager last)
require('./RhythmValues');
require('./rhythmModulator');
require('./FXFeedbackListener');
require('./PhaseLockedRhythmGenerator');
require('./rhythmConfig');
require('./rhythmPriorsData');
require('./rhythmPriors');
require('./RhythmRegistry');
require('./RhythmManager');

// Ensure drumMap is loaded before drummer (drummer depends on drumMap internals)
require('./drumMap');
require('./drummer');
require('./playDrums');
require('./playDrums2');
require('./makeOnsets');
require('./patternLength');
require('./getRhythm');
require('./setRhythm');
require('./trackRhythm');
require('./patterns');
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
