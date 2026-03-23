
require('./events');

require('./channelCoherence');
require('./minimumNoteDuration');
require('./emitPickCrossLayerRecord');
require('./emitPickTextureEmit');

require('./playNotesEmitPick');

require('./playNotesComputeUnit');

require('./playNotes');

require('./microUnitAttenuator');

require('./crossLayerBeatRecord');

require('./processBeat');

require('./layerPass');
// Explicitly include main in index require list so that file listings are comprehensive
// (main is guarded and will not auto-run when required as a module)
require('./main');
require('./beatPipelineDescriptor');
require('./feedbackGraphContract');

require('./mainBootstrap');

require('./fullBootstrap');
