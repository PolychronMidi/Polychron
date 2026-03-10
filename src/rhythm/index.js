// Subsystem helpers (helpers first, manager last)

require('./rhythmValues');

require('./rhythmModulator');

require('./rhythmConfig');

require('./rhythmPriorsData');

require('./rhythmRegistry');

require('./RhythmManager');
// Drum subsystem (drumMap - drummer - playDrums - playDrums2 - drumTextureCoupler)
require('./drums');

require('./makeOnsets');

require('./patternLength');

require('./getRhythm');


require('./trackRhythm');

require('./patterns');
require('./setRhythm');
require('./feedback');

require('./rhythmHistoryTracker');

require('./phaseLockedRhythmGenerator');

require('./rhythmPriors');

require('./crossModulateRhythms');


// Preserve legacy naked global mapping for backward compatibility
rhythmMethods = rhythmRegistry.getAll();
