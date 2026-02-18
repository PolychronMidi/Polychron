require('./conductor');
// @ts-ignore: side-effect module load
require('./events');
require('./utils');
require('./rhythm');
require('./time');
require('./composers');
require('./fx');
// @ts-ignore: side-effect module load
require('./channelCoherence');
// @ts-ignore: side-effect module load
require('./playNotesEmitPick');
// @ts-ignore: side-effect module load
require('./playNotes');
// @ts-ignore: side-effect module load
require('./microUnitAttenuator');
require('./writer');
// Explicitly include main in index require list so that file listings are comprehensive
// (main is guarded and will not auto-run when required as a module)
require('./main');
