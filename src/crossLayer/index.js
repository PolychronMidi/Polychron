// src/crossLayer/index.js - Central entry for cross-layer interaction modules.

// Registry MUST load first so every module below can self-register.
// @ts-ignore: side-effect module load
require('./crossLayerRegistry');


// @ts-ignore: side-effect module load
require('./explainabilityBus');

// @ts-ignore: shared cross-layer helpers for layer routing, tick conversion, and MIDI bounds
require('./crossLayerHelpers');

// @ts-ignore: thin gateway for cross-layer MIDI buffer writes (attribution + density tracking)
require('./crossLayerEmissionGateway');

// @ts-ignore: side-effect module load
require('./rhythm');
// @ts-ignore: side-effect module load
require('./harmony');
// @ts-ignore: side-effect module load
require('./dynamics');
// Subsystem groups - each subfolder index.js loads its own modules.
// @ts-ignore: side-effect module load
require('./structure');


// @ts-ignore: conductor-crossLayer signal bridge (registers recorder + crossLayerRegistry)
require('./conductorSignalBridge');


// Lifecycle manager loads LAST - after all modules have self-registered.
// @ts-ignore: side-effect module load
require('./crossLayerLifecycleManager');
