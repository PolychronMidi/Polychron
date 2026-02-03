require('./formatTime');
require('./logUnit');
require('./grandFinale');
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

c = c1 = c2 = []; // naked global current buffer and layer buffers for csv rows


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
      console.error('Failed to write', args[0] || '', err);
      throw err;
    }
  };
} catch (err) {
  console.error('Failed to wrap fs.writeFileSync:', err);
}
