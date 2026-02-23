// @ts-ignore: side-effect module load
require('./events');
// @ts-ignore: side-effect module load
require('./channelCoherence');
// @ts-ignore: side-effect module load — cross-layer recording helper (must precede playNotesEmitPick)
require('./emitPickCrossLayerRecord');
// @ts-ignore: side-effect module load — texture emission helper (must precede playNotesEmitPick)
require('./emitPickTextureEmit');
// @ts-ignore: side-effect module load
require('./playNotesEmitPick');
// @ts-ignore: side-effect module load
require('./playNotesComputeUnit');
// @ts-ignore: side-effect module load
require('./playNotes');
// @ts-ignore: side-effect module load
require('./microUnitAttenuator');
// @ts-ignore: side-effect module load
require('./fullBootstrap');
// @ts-ignore: side-effect module load
require('./mainBootstrap');
// @ts-ignore: side-effect module load
require('./crossLayerBeatRecord');
// @ts-ignore: side-effect module load — declarative beat stage graph (must precede processBeat)
require('./beatPipelineDescriptor');
// @ts-ignore: side-effect module load
require('./processBeat');
// @ts-ignore: side-effect module load
require('./layerPass');
// Explicitly include main in index require list so that file listings are comprehensive
// (main is guarded and will not auto-run when required as a module)
require('./main');
