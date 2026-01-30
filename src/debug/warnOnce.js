const { writeDebugFile } = require('./logGate');
const TEST = require('../test-setup');

const _polychron_warned = new Set();

/**
 * Log a warning once per unique key to avoid flooding logs with repeated warnings.
 * @param {string} key - Unique key for the warning.
 * @param {string} msg - Human-readable warning message.
 */
function warnOnce(key, msg) {
  try {
    if (_polychron_warned.has(key)) return;
    _polychron_warned.add(key);
    // Gate warnings via logGate (debug category)
    try { writeDebugFile('warnings.ndjson', { key, msg }); } catch (e) { /* swallow */ }
  } catch (e) { /* swallow logging errors */ }
}

try { module.exports = warnOnce; } catch (e) { /* swallow */ }
