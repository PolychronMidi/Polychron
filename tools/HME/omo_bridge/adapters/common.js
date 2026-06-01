const { UNIVERSAL_HOOK_ABI, assertUniversalEvent, isPlainObject } = require('../universal_event');

function stableTimestamp(options = {}) {
  return options.timestamp || new Date(0).toISOString();
}

function baseEvent(native = {}, options = {}, source = {}) {
  return {
    abi: UNIVERSAL_HOOK_ABI,
    id: options.id || native.id || `${source.host || 'host'}-${source.rawEventName || native.event || native.hook || 'event'}`,
    timestamp: stableTimestamp(options),
    source,
  };
}

function lifecycle(eventName) {
  return { lifecycle: { event: eventName } };
}

function parseMaybeJson(value) {
  if (isPlainObject(value)) return value;
  if (typeof value !== 'string') return value === undefined ? {} : value;
  try {
    const parsed = JSON.parse(value);
    return parsed === null ? {} : parsed;
    // silent-ok: adapter accepts non-JSON host payloads as raw values for compatibility.
  } catch (_) {
    return { raw: value };
  }
}

function validate(event) {
  return assertUniversalEvent(event);
}

module.exports = { baseEvent, lifecycle, parseMaybeJson, validate };
