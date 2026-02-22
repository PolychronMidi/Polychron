// src/crossLayer/index.js — Central entry for cross-layer interaction modules.

// Registry MUST load first so every module below can self-register.
// @ts-ignore: side-effect module load
require('./CrossLayerRegistry');

// @ts-ignore: side-effect module load
require('./explainabilityBus');

// Subsystem groups — each subfolder index.js loads its own modules.
// @ts-ignore: side-effect module load
require('./structure');
// @ts-ignore: side-effect module load
require('./harmony');
// @ts-ignore: side-effect module load
require('./rhythm');
// @ts-ignore: side-effect module load
require('./dynamics');

// @ts-ignore: conductor→crossLayer signal bridge (registers recorder + CrossLayerRegistry)
require('./conductorSignalBridge');

// Lifecycle manager loads LAST — after all modules have self-registered.
// @ts-ignore: side-effect module load
require('./crossLayerLifecycleManager');
