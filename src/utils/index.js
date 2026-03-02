m=Math;
// @ts-ignore: side-effect module load
require('./validator');
// @ts-ignore: shared lifecycle utility (must precede crossLayerRegistry & conductorIntelligence)
require('./moduleLifecycle');
// @ts-ignore: formal registry for closed-loop feedback controllers
require('./feedbackRegistry');
// @ts-ignore: reusable closed-loop controller factory (depends on feedbackRegistry)
require('./closedLoopController');
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
require('./init');
require('./midiData');
// @ts-ignore: side-effect module load
require('./randoms');
// @ts-ignore: side-effect module load
require('./instrumentation');
// eventCatalog only depends on validator - loaded here so all downstream subsystems
// (crossLayer, play) can reference eventCatalog.names at module level.
// @ts-ignore: side-effect module load
require('./eventCatalog');
// trustSystems - canonical trust system name constants. Follows eventCatalog pattern.
// @ts-ignore: side-effect module load
require('./trustSystems');
// @ts-ignore: side-effect module load
require('./formatTime');
