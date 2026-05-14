'use strict';
/**
 * Compatibility shim.
 *
 * The authoritative event dispatcher lives in tools/HME/event_kernel so hook
 * adapters and the proxy share one routing table. Keep this file importable
 * for older scripts, tests, and validators.
 */

module.exports = require('../event_kernel/dispatcher');
