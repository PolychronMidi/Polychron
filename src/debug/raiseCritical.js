/**
 * Raise a critical error via centralized postfix guard.
 * Delegates to `postfixGuard.raiseCritical` and falls back to writing a fatal log and throwing.
 * @param {string} key - Short key for the critical (e.g., 'boundary:beat')
 * @param {string} msg - Human-readable critical message
 * @param {object} [ctx] - Additional context to attach to diagnostics
 * @returns {any}
 */
const { writeFatal } = require('./logGate');
const TEST = require('../test-hooks');

/**
 * Raise a critical error via centralized postfix guard.
 * Delegates to `postfixGuard.raiseCritical` and falls back to writing a fatal log and throwing.
 * @param {string} key - Short key for the critical (e.g., 'boundary:beat')
 * @param {string} msg - Human-readable critical message
 * @param {object} [ctx] - Additional context to attach to diagnostics
 * @returns {any}
 */
function raiseCritical(key, msg, ctx = {}) {
  try { if (TEST && TEST.DEBUG) console.log('raiseCritical called', { key, msg }); } catch (e) { /* swallow */ }
  try {
    const guard = require('./postfixGuard');
    return guard.raiseCritical(key, msg, ctx);
  } catch (e) {
    try { writeFatal({ when: new Date().toISOString(), type: 'postfix-anti-pattern', severity: 'critical', key, msg, stack: (new Error()).stack, ctx }); } catch (_e) { /* swallow */ }
    throw new Error('CRITICAL: ' + msg);
  }
}

try { module.exports = raiseCritical; } catch (e) { /* swallow */ }
try { Function('f', 'this.raiseCritical = f')(raiseCritical); } catch (e) { /* swallow */ }
