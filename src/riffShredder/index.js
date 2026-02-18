// riffShredder/index.js — lightweight sandbox bootstrap
// Loads the full runtime (config, utils, rhythm, time, composers, fx, writer)
// then runs shred.js as an alternative to main.js.
//
// Usage: node src/riffShredder/index.js
//   or:  npm run shred
//
// Architecture:
//   Single layer ("SHRED"), fixed 72 BPM, 4/4 meter.
//   Only beats, divs, subdivs, subsubdivs — no sections/phrases hierarchy.
//   Designed for rapid rhythm/cross-modulation/variation experiments.

require('../index');
// @ts-ignore: side-effect module load
require('./shred');

if (require.main === module) {
  shred().catch((err) => {
    process.stderr.write('riffShredder failed: ' + (err && err.stack ? err.stack : err) + '\n');
    process.exit(1);
  });
}
