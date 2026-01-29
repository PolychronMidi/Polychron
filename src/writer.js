// writer.js - MIDI output and file generation with CSV buffer management.
// minimalist comments, details at: writer.md

let fs = require('fs');
const path = require('path');
const { writeDebugFile, writeFatal } = require('./logGate');
const { raiseCritical } = require('./postfixGuard');
// Import canonical system constants from sheet.js (LOG, TUNING_FREQ, BINAURAL, etc.)
require('./sheet');
// Initialize naked globals and utility helpers defined in backstage
require('./backstage');
// Centralized test hook object (replace __POLYCHRON_TEST__ global)
const TEST = require('./test-hooks');


/**
 * @typedef {{parts?: string[], startTick?: number, endTick?: number, startTime?: number, endTime?: number}} Unit
 * @typedef {{tick?: number, type?: string, vals?: any[], _tickSortKey?: number, _unitHash?: string}} BufferEvent
 */

/**
 * Layer-aware MIDI event buffer.
 * @class CSVBuffer
 * @param {string} name - Layer identifier ('primary', 'poly', etc.).
 * @property {string} name - Layer identifier.
 * @property {Array<object>} rows - MIDI event objects: {tick, type, vals}.
 * @property {number} length - Read-only count of events.
 */
class CSVBuffer {
  /**
   * @param {string} name
   */
  constructor(name) {
    /** @type {string} */ this.name = name;
    /** @type {Array<BufferEvent>} */ this.rows = [];
  }
  /** @param {...BufferEvent} items */
  push(...items) {
    this.rows.push(...items);
  }
  get length() {
    return this.rows.length;
  }
  clear() {
    this.rows = [];
  }
}

/**
 * Push multiple items onto a buffer/array.
 * @param {CSVBuffer|Array<any>} buffer - The target buffer to push onto.
 * @param {...*} items - Items to push onto the buffer.
 * @returns {void}
 */
const pushMultiple = (buffer, ...items) => { buffer.push(...items); };
const p = pushMultiple;

// Initialize buffers (c1/c2 created here, layers register them in play.js)
const c1 = new CSVBuffer('primary');
const c2 = new CSVBuffer('poly');
/** @type {CSVBuffer} */ c = (typeof c !== 'undefined') ? c : c1;  // Active buffer reference (naked global)
// ensure a naked global c exists and references c1 (preserve legacy behavior)
if (typeof c === 'undefined') c = c1;


const { logUnit } = require('./logUnit');



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

// Load external grandFinale implementation and expose global for tests that expect it
const grandFinale = require('./grandFinale');
try { Function('return this')().grandFinale = grandFinale; } catch (e) { /* swallow */ }

// Explicit module exports for direct importing by tests/tools. Do NOT mutate globals here.
module.exports = { p, CSVBuffer, logUnit, grandFinale };
