// Subsystem helpers (helpers first, manager last)

require('./chordValues');
require('./chordModulator');
require('./chordConfig');
require('./chordRegistry');
require('./ChordManager');

require('./chordUtils');
require('./harmonicPriorsData');
require('./harmonicPriors');
require('./ChordComposer');
require('./ProgressionGenerator');
require('./pivotChordBridge');

// Register progression generator wrapper as a declared module so it
// participates in the manifest registry (full DI: every registrant is a
// declared module, no legacy registerInitializer wrappers).
moduleLifecycle.declare({
  name: 'chordProgressionRegistration',
  subsystem: 'composers',
  deps: ['chordRegistry'],
  provides: ['chordProgressionRegistration'],
  init: (deps) => {
    deps.chordRegistry.register('progression', (key, quality, type) => {
      const pg = new ProgressionGenerator(key, quality);
      return type ? pg.generate(type) : pg.random();
    });
    return { registered: true };
  },
});
