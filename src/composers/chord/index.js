// Subsystem helpers (helpers first, manager last)
// @ts-ignore: load side-effect module with globals
require('./chordValues');
// @ts-ignore: load side-effect module with globals
require('./chordModulator');
// @ts-ignore: load side-effect module with globals
require('./chordConfig');
// @ts-ignore: load side-effect module with globals
require('./chordRegistry');
// @ts-ignore: load side-effect module with globals
require('./chordManager');

// @ts-ignore: load side-effect module with globals
require('./chordUtils');
// @ts-ignore: load side-effect module with globals
require('./harmonicPriorsData');
// @ts-ignore: load side-effect module with globals
require('./harmonicPriors');
// @ts-ignore: load side-effect module with globals
require('./ChordComposer');
// @ts-ignore: load side-effect module with globals
require('./ProgressionGenerator');
// @ts-ignore: load side-effect module with globals
require('./pivotChordBridge');

// Register progression generator wrapper
chordRegistry.register('progression', (key, quality, type) => {
  const pg = new ProgressionGenerator(key, quality);
  return type ? pg.generate(type) : pg.random();
});


