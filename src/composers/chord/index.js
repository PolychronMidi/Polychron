// Subsystem helpers (helpers first, manager last)
// @ts-ignore: load side-effect module with globals
require('./ChordValues');
// @ts-ignore: load side-effect module with globals
require('./chordModulator');
// @ts-ignore: load side-effect module with globals
require('./chordConfig');
// @ts-ignore: load side-effect module with globals
require('./ChordRegistry');
// @ts-ignore: load side-effect module with globals
require('./ChordManager');

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

// Register progression generator wrapper
ChordRegistry.register('progression', (key, quality, type) => {
  if (typeof ProgressionGenerator !== 'function') throw new Error('progression generator: ProgressionGenerator not available');
  const pg = new ProgressionGenerator(key, quality);
  return type ? pg.generate(type) : pg.random();
});
