// src/crossLayer/index.js - Central entry for cross-layer interaction modules.

// Registry MUST load first so every module below can self-register.

require('./crossLayerRegistry');



require('./explainabilityBus');

require('./crossLayerHelpers');

require('./crossLayerEmissionGateway');


require('./rhythm');

require('./harmony');

require('./dynamics');
// Subsystem groups - each subfolder index.js loads its own modules.

require('./conductorSignalBridge');


require('./structure');

require('./coordinationIndependenceManager');

// Lifecycle manager loads LAST - after all modules have self-registered.

require('./crossLayerLifecycleManager');
