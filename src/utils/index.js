m=Math;

require('./validator');
require('./moduleLifecycle');
require('./feedbackRegistry');
require('./closedLoopController');
require('./beatCache');

require('./systemSnapshot');

require('./modeQualityMap');

require('./priorsHelpers');

require('./clamps');

require('./propertyExtractors');

require('./init');
require('./midiData');

require('./randoms');

require('./instrumentation');
// eventCatalog only depends on validator - loaded here so all downstream subsystems
// (crossLayer, play) can reference eventCatalog.names at module level.

require('./eventCatalog');
// trustSystems - canonical trust system name constants. Follows eventCatalog pattern.

require('./trustSystems');
require('./safePreBoot');

require('./formatTime');
require('./musicalTimeWindows');
