// Subsystem helpers (helpers first, manager last)
// @ts-ignore: load side-effect module with globals
require('./motifValues');
// @ts-ignore: load side-effect module with globals
require('./motifModulator');
// @ts-ignore: load side-effect module with globals
require('./motifConfig');
// @ts-ignore: load side-effect module with globals
require('./motifRegistry');
// @ts-ignore: load side-effect module with globals
require('./motifManager');
// @ts-ignore: load side-effect module with globals
require('./motifValidators');
// @ts-ignore: load side-effect module with globals
require('./MotifComposer');
// @ts-ignore: load side-effect module with globals
require('./motifs');
// @ts-ignore: load side-effect module with globals
require('./motifChain');
// @ts-ignore: load side-effect module with globals
require('./motifTransformAdvisor');
// @ts-ignore: load side-effect module with globals
require('./motifSpreader');
// @ts-ignore: load side-effect module with globals
require('./motifTransforms');
// @ts-ignore: load side-effect module with globals
require('./candidateExpansion');
// @ts-ignore: load side-effect module with globals
require('./playMotifsResolveBucket');
// @ts-ignore: load side-effect module with globals
require('./playMotifsBuildCandidateNotes');
// @ts-ignore: load side-effect module with globals
require('./playMotifsApplyCycleTransforms');
// @ts-ignore: load side-effect module with globals
require('./playMotifs');

// Register default generator wrapper
MotifRegistry.register('motif', (opts = {}) => {
  const mc = new MotifComposer(opts);
  return mc.generate(opts);
});


