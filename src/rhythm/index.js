// Subsystem helpers (helpers first, manager last)
// @ts-ignore: side-effect module load
require('./rhythmValues');
// @ts-ignore: side-effect module load
require('./rhythmModulator');
// @ts-ignore: side-effect module load
require('./rhythmConfig');
// @ts-ignore: side-effect module load
require('./rhythmPriorsData');
// @ts-ignore: side-effect module load
require('./rhythmRegistry');
// @ts-ignore: side-effect module load
require('./rhythmManager');
// Drum subsystem (drumMap - drummer - playDrums - playDrums2 - drumTextureCoupler)
// @ts-ignore: drum pattern generation and texture coupling
require('./drums');
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
// @ts-ignore: feedback listeners (cross-layer eventBus bridges)
require('./feedback');
// @ts-ignore: side-effect module load
require('./rhythmHistoryTracker');
// @ts-ignore: side-effect module load
require('./phaseLockedRhythmGenerator');
// @ts-ignore: side-effect module load
require('./rhythmPriors');
// @ts-ignore: side-effect module load
require('./crossModulateRhythms');


// Preserve legacy naked global mapping for backward compatibility
rhythmMethods = rhythmRegistry.getAll();
