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

// Register progression generator wrapper
chordRegistry.register('progression', (key, quality, type) => {
  const pg = new ProgressionGenerator(key, quality);
  return type ? pg.generate(type) : pg.random();
});
