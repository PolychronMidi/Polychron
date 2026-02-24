// src/crossLayer/index.js â€” Central entry for cross-layer interaction modules.

// Registry MUST load first so every module below can self-register.
// @ts-ignore: side-effect module load
require('./crossLayerRegistry');

// @ts-ignore: side-effect module load
require('./explainabilityBus');

// Subsystem groups â€” each subfolder index.js loads its own modules.
// @ts-ignore: side-effect module load
require('./structure');
// @ts-ignore: side-effect module load
require('./harmony');
// @ts-ignore: side-effect module load
require('./rhythm');
// @ts-ignore: side-effect module load
require('./dynamics');

// @ts-ignore: conductorâ†’crossLayer signal bridge (registers recorder + CrossLayerRegistry)
require('./conductorSignalBridge');

// Lifecycle manager loads LAST â€” after all modules have self-registered.
// @ts-ignore: side-effect module load
require('./crossLayerLifecycleManager');


