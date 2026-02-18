require('./conductor');
require('./events');
require('./utils');
require('./rhythm');
require('./time');
require('./composers');
require('./fx');
require('./channelCoherence');
require('./playNotes');
require('./microUnitAttenuator');
require('./writer');
// Explicitly include main in index require list so that file listings are comprehensive
// (main is guarded and will not auto-run when required as a module)
require('./main');
