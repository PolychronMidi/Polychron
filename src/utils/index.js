m=Math;
// @ts-ignore: side-effect module load
require('./validators');
// @ts-ignore: shared lifecycle utility (must precede CrossLayerRegistry & ConductorIntelligence)
require('./ModuleLifecycle');
// @ts-ignore: per-beat memoization for expensive conductor queries
require('./beatCache');
// @ts-ignore: side-effect module load
require('./SystemSnapshot');
// @ts-ignore: side-effect module load
require('./modeQualityMap');
// @ts-ignore: side-effect module load
require('./priorsHelpers');
// @ts-ignore: side-effect module load
require('./clamps');
// @ts-ignore: side-effect module load
require('./randoms');
// @ts-ignore: side-effect module load
require('./init');
require('./midiData');
// @ts-ignore: side-effect module load
require('./instrumentation');
