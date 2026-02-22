// src/crossLayer/CrossLayerRegistry.js — Self-registration hub for cross-layer modules.
// Each module registers itself with reset scopes ('all', 'section', 'phrase').
// CrossLayerLifecycleManager iterates this registry instead of probing typeof guards.
// Lifecycle management delegates to the shared ModuleLifecycle utility.

CrossLayerRegistry = (() => {
  const lifecycle = ModuleLifecycle.create('CrossLayerRegistry');

  return {
    register: lifecycle.register,
    resetAll: lifecycle.resetAll,
    resetSection: lifecycle.resetSection,
    resetPhrase: lifecycle.resetPhrase,
    getRegisteredNames: lifecycle.getNames,
    getCount: lifecycle.getCount
  };
})();
