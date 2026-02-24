// @ts-ignore: side-effect module load
require('./formatTime');
// @ts-ignore: side-effect module load
require('./logUnit');
// @ts-ignore: side-effect module load
require('./grandFinale');
// @ts-ignore: side-effect module load — coherence verdicts engine
require('./coherenceVerdicts');
// @ts-ignore: side-effect module load — capability matrix markdown renderer
require('./systemManifestMarkdown');
// @ts-ignore: side-effect module load — system manifest & capability matrix output
require('./systemManifest');
fs = require('fs');
path = require('path');
/**
 * Outputs separate MIDI files for each layer with automatic synchronization.
 * @description
 * Architecture:
 * - output1.csv/mid: Primary layer with its syncFactor
 * - output2.csv/mid: Poly layer with independent syncFactor
 * - output3.csv/mid+: Additional layers (when added)
 * - Phrase boundaries align perfectly in absolute time (seconds)
 * - Tick counts differ due to different tempo adjustments
 * - Automatically handles any number of layers
 * @returns {void}
 */


/**
 * Push multiple items onto a buffer/array.
 * @param {...*} items - Items to push onto the buffer.
 * @returns {void}
 */
pushMultiple = (buffer, ...items) => { buffer.push(...items); };
p = pushMultiple;

c1 = []; // layer 1 CSV row buffer
c2 = []; // layer 2 CSV row buffer
c = c1; // current active buffer (reassigned per-layer pass)


/**
 * Node.js filesystem module with wrapped writeFileSync for error logging.
 * @type {Object}
 */
// Wrap writeFileSync to log errors centrally
try {
  const _origWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = function(...args) {
    try {
      return _origWriteFileSync.apply(fs, args);
    } catch (err) {
      throw new Error('Failed to write ' + (args[0] || '') + ': ' + (err && err.stack ? err.stack : String(err)));
    }
  };
} catch (err) {
  throw new Error('Failed to wrap fs.writeFileSync: ' + (err && err.stack ? err.stack : String(err)));
}
