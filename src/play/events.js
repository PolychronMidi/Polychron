// src/events.js - Lightweight event dispatcher for feedback loops

eventBus = (() => {
  const V = validator.create('events');
  const listenersMap = {}; // { eventName: [handlers] }

  function on(name, handler) {
    V.assertNonEmptyString(name, 'on.name');
    V.requireType(handler, 'function', 'on.handler');
    if (!listeners[name]) listeners[name] = [];
    listeners[name].push(handler);
  }

  function off(name, handler) {
    V.assertNonEmptyString(name, 'off.name');
    if (!listenersMap[name]) return;
    listenersMap[name] = listenersMap[name].filter(h => h !== handler);
  }

  function emit(name, data) {
    V.assertNonEmptyString(name, 'emit.name');
    eventCatalog.validateEmit(name, data);
    if (!listenersMap[name]) return;
    // Fail-fast: let any listener exception bubble
    for (const handler of listenersMap[name]) {
      handler(data);
    }
  }

  function listeners(name) {
    return listenersMap[name] ? listenersMap[name].length : 0;
  }

  function clear(name) {
    V.assertNonEmptyString(name, 'clear.name');
    delete listenersMap[name];
  }

  function clearAll() {
    Object.keys(listenersMap).forEach(key => delete listenersMap[key]);
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
