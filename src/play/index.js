// @ts-ignore: side-effect module load
require('./EventCatalog');
// @ts-ignore: side-effect module load
require('./events');
// @ts-ignore: side-effect module load
require('./channelCoherence');
// @ts-ignore: side-effect module load
require('./playNotesEmitPick');
// @ts-ignore: side-effect module load
require('./playNotes');
// @ts-ignore: side-effect module load
require('./microUnitAttenuator');
// @ts-ignore: side-effect module load
require('./fullBootstrap');
// @ts-ignore: side-effect module load
require('./mainBootstrap');
// @ts-ignore: side-effect module load
require('./processBeat');
// @ts-ignore: side-effect module load
require('./layerPass');
// Explicitly include main in index require list so that file listings are comprehensive
// (main is guarded and will not auto-run when required as a module)
require('./main');
