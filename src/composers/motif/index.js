// Subsystem helpers (helpers first, manager last)
// @ts-ignore: load side-effect module with globals
require('./MotifValues');
// @ts-ignore: load side-effect module with globals
require('./motifModulator');
// @ts-ignore: load side-effect module with globals
require('./motifConfig');
// @ts-ignore: load side-effect module with globals
require('./MotifRegistry');
// @ts-ignore: load side-effect module with globals
require('./MotifManager');
// @ts-ignore: load side-effect module with globals
require('./MotifDurationPlanner');
// @ts-ignore: load side-effect module with globals
require('./MotifComposer');
// @ts-ignore: load side-effect module with globals
require('./motifs');
// @ts-ignore: load side-effect module with globals
require('./MotifChain');
// @ts-ignore: load side-effect module with globals
require('./motifSpreader');
// @ts-ignore: load side-effect module with globals
require('./MotifTransforms');
// @ts-ignore: load side-effect module with globals
require('./CandidateExpansion');
// @ts-ignore: load side-effect module with globals
require('./playMotifs');

// Register default generator wrapper
MotifRegistry.register('motif', (opts = {}) => {
  if (typeof MotifComposer !== 'function') throw new Error('motif generator: MotifComposer not available');
  const mc = new MotifComposer(opts);
  return mc.generate(opts);
});
