// src/events.js - Lightweight event dispatcher for feedback loops

EventBus = (() => {
  const _listeners = {}; // { eventName: [handlers] }

  function on(name, handler) {
    if (typeof name !== 'string' || !name) throw new Error('EventBus.on: invalid event name');
    if (typeof handler !== 'function') throw new Error('EventBus.on: handler must be a function');
    if (!_listeners[name]) _listeners[name] = [];
    _listeners[name].push(handler);
  }

  function off(name, handler) {
    if (typeof name !== 'string' || !name) throw new Error('EventBus.off: invalid event name');
    if (!_listeners[name]) return;
    _listeners[name] = _listeners[name].filter(h => h !== handler);
  }

  function emit(name, data) {
    if (typeof name !== 'string' || !name) throw new Error('EventBus.emit: invalid event name');
    if (EventCatalog && typeof EventCatalog.validateEmit === 'function') {
      EventCatalog.validateEmit(name, data);
    }
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
    if (typeof name !== 'string' || !name) throw new Error('EventBus.clear: invalid event name');
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
