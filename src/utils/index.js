m=Math;
// @ts-ignore: side-effect module load
require('./validator');
// @ts-ignore: shared lifecycle utility (must precede CrossLayerRegistry & ConductorIntelligence)
require('./moduleLifecycle');
// @ts-ignore: per-beat memoization for expensive conductor queries
require('./beatCache');
// @ts-ignore: side-effect module load
require('./systemSnapshot');
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
// EventCatalog only depends on validator - loaded here so all downstream subsystems
// (crossLayer, play) can reference EventCatalog.names at module level.
// @ts-ignore: side-effect module load
require('./eventCatalog');
// @ts-ignore: side-effect module load
require('./formatTime');
