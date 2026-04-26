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

// Register default generator as a declared module (full DI -- every
// registrant goes through the manifest registry, not legacy
// registerInitializer wrappers).
moduleLifecycle.declare({
  name: 'motif-default-registration',
  subsystem: 'composers',
  deps: ['motifRegistry'],
  provides: ['motif-default-registration'],
  init: (deps) => {
    deps.motifRegistry.register('motif', (opts = {}) => {
      const mc = new MotifComposer(opts);
      return mc.generate(opts);
    });
    return { registered: true };
  },
});
