
require('./logUnit');

require('./grandFinale');

require('./traceDrain');

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
// Tap every emission to populate channelStateField. Note-on events feed the
// 'velocity' dimension (no other path does -- gateway only observes cross-layer
// modules). Control_c events are already observed at their call sites, but
// catching them here too is harmless (substrate dedupe via writer tag).
// Writer tag 'direct-p' marks emissions that bypassed any module-level tag;
// anyone wanting finer attribution should call channelStateField.write()
// directly with their module name before p().
pushMultiple = (buffer, ...items) => {
  buffer.push(...items);
  for (let i = 0; i < items.length; i++) {
    const ev = items[i];
    if (ev && ev.type === 'on' && Array.isArray(ev.vals) && ev.vals.length >= 3) {
      channelStateField.write(ev.vals[0], 'velocity', ev.vals[2], 'direct-p');
    }
  }
};
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
  const indexOrigWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = function(...args) {
    try {
      return indexOrigWriteFileSync.apply(fs, args);
    } catch (err) {
      throw new Error('Failed to write ' + (args[0] || '') + ': ' + (err && err.stack ? err.stack : String(err)));
    }
  };
} catch (err) {
  throw new Error('Failed to wrap fs.writeFileSync: ' + (err && err.stack ? err.stack : String(err)));
}
