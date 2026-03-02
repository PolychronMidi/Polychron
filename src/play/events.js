// src/events.js - Lightweight event dispatcher for feedback loops

eventBus = (() => {
  const V = validator.create('events');
  const _listeners = {}; // { eventName: [handlers] }

  function on(name, handler) {
    V.assertNonEmptyString(name, 'on.name');
    V.requireType(handler, 'function', 'on.handler');
    if (!_listeners[name]) _listeners[name] = [];
    _listeners[name].push(handler);
  }

  function off(name, handler) {
    V.assertNonEmptyString(name, 'off.name');
    if (!_listeners[name]) return;
    _listeners[name] = _listeners[name].filter(h => h !== handler);
  }

  function emit(name, data) {
    V.assertNonEmptyString(name, 'emit.name');
    eventCatalog.validateEmit(name, data);
    if (!_listeners[name]) return;
    // Fail-fast: let any listener exception bubble
    for (const handler of _listeners[name]) {
      handler(data);
    }
  }

  function listeners(name) {
    return _listeners[name] ? _listeners[name].length : 0;
  }

  function clear(name) {
    V.assertNonEmptyString(name, 'clear.name');
    delete _listeners[name];
  }

  function clearAll() {
    Object.keys(_listeners).forEach(key => delete _listeners[key]);
  }

  return {
    on,
    off,
    emit,
    listeners,
    clear,
    clearAll
  };
})();
