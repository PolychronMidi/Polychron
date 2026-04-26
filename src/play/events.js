// src/events.js - Lightweight event dispatcher for feedback loops

moduleLifecycle.declare({
  name: 'eventBus',
  subsystem: 'play',
  deps: ['validator'],
  provides: ['eventBus'],
  init: (deps) => {
  const V = deps.validator.create('events');
  const listenersMap = {}; // { eventName: [handlers] }

  function on(name, handler) {
    V.assertNonEmptyString(name, 'on.name');
    V.requireType(handler, 'function', 'on.handler');
    if (!listenersMap[name]) listenersMap[name] = [];
    listenersMap[name].push(handler);
  }

  function off(name, handler) {
    V.assertNonEmptyString(name, 'off.name');
    if (!listenersMap[name]) return;
    listenersMap[name] = listenersMap[name].filter(h => h !== handler);
  }

  const HIGH_FREQ = new Set(['notes-emitted', 'stutter-applied']);

  function emit(name, data) {
    if (!listenersMap[name]) return;
    if (!HIGH_FREQ.has(name)) {
      V.assertNonEmptyString(name, 'emit.name');
      eventCatalog.validateEmit(name, data);
    }
    for (let i = 0; i < listenersMap[name].length; i++) {
      listenersMap[name][i](data);
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
  },
});
