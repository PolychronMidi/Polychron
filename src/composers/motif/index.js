// Subsystem helpers (helpers first, manager last)
require('./motifValues');
require('./motifModulator');
require('./motifConfig');
require('./motifRegistry');
require('./motifManager');
require('./motifValidators');
require('./MotifComposer');
require('./Motif');
require('./motifChain');
require('./motifTransformAdvisor');
require('./motifSpreader');
require('./motifTransforms');
require('./candidateExpansion');
require('./playMotifsResolveBucket');
require('./playMotifsBuildCandidateNotes');
require('./playMotifsApplyCycleTransforms');
require('./playMotifs');

// Register default generator wrapper
motifRegistry.register('motif', (opts = {}) => {
  const mc = new MotifComposer(opts);
  return mc.generate(opts);
});
