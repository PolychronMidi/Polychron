// src/crossLayer/crossLayerRegistry.js - Self-registration hub for cross-layer modules.
// Each module registers itself with reset scopes ('all', 'section', 'phrase').
// crossLayerLifecycleManager iterates this registry instead of probing typeof guards.
// Lifecycle management delegates to the shared moduleLifecycle utility.

moduleLifecycle.declare({
  name: 'crossLayerRegistry',
  subsystem: 'crossLayer',
  deps: [],
  provides: ['crossLayerRegistry'],
  init: (deps) => {
  const lifecycle = moduleLifecycle.create('crossLayerRegistry');

  return {
    register: lifecycle.register,
    resetAll: lifecycle.resetAll,
    resetSection: lifecycle.resetSection,
    resetPhrase: lifecycle.resetPhrase,
    getRegisteredNames: lifecycle.getNames,
    getCount: lifecycle.getCount
  };
  },
});
