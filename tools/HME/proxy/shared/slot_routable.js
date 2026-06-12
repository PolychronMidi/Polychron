'use strict';

// Single source of truth for "is this active-active backend slot routable?".
//

const { requireEnvInt } = require('./load_env');

// Canonical pid-liveness probe. `process.kill(pid, 0)` sends no signal; it only
// checks that the pid exists and is signalable by us. Replaces the formerly
function isPidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try { process.kill(n, 0); return true; } catch (_) { return false; }
}

// Canonical staleness window (ms). Read lazily so this module has no env side
// effect at require() time (keeps pure-function tests env-free).
function defaultStaleMs() {
  return requireEnvInt('HME_PROXY_HEARTBEAT_STALE_MS');
}

// The one routability predicate. `health` is a parsed proxy-<slot>.health object
// (or null). opts: { now, staleMs, isAlive } are injectable for tests.
function isSlotRoutable(health, opts = {}) {
  if (!health || typeof health !== 'object') return false;
  const now = Number(opts.now !== undefined ? opts.now : Date.now());
  const staleMs = Number(opts.staleMs !== undefined ? opts.staleMs : defaultStaleMs());
  const isAlive = opts.isAlive || isPidAlive;
  if (!health.ready || health.draining) return false;
  if ((now - Number(health.ts || 0)) > staleMs) return false;
  if (!isAlive(health.pid)) return false;
  return true;
}

module.exports = { isPidAlive, isSlotRoutable, defaultStaleMs };
