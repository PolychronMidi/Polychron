// src/crossLayer/crossLayerLifecycleManager.js - Delegates to crossLayerRegistry.
// L0 and timeStream (from src/time/) register into the lifecycle
// here so they participate in scoped resets automatically.

// timeStream registration as a declared module (full DI -- the registrant
// itself is a declared module that depends on crossLayerRegistry and
// timeStream, runs in topo order after both are bound).
moduleLifecycle.declare({
  name: 'timeStreamCrosslayerRegistration',
  subsystem: 'crossLayer',
  deps: ['crossLayerRegistry', 'timeStream'],
  lazyDeps: ['conductorSignalBridge'],
  provides: ['timeStreamCrosslayerRegistration'],
  init: (deps) => {
    const crossLayerRegistry = deps.crossLayerRegistry;
    const conductorSignalBridge = deps.conductorSignalBridge;
    deps.crossLayerRegistry.register('timeStream', { reset: deps.timeStream.resetPositions }, ['all']);
    return { registered: true };
  },
});

moduleLifecycle.declare({
  name: 'crossLayerLifecycleManager',
  subsystem: 'crossLayer',
  deps: [],
  provides: ['crossLayerLifecycleManager'],
  init: () => {
  let hasRunSection = false;

  function resetAll() {
    hasRunSection = false;
    crossLayerRegistry.resetAll();
  }

  function resetSection() {
    // After the first section completes, verify the conductor-cross-layer bridge
    // is alive. If conductorSignalBridge failed to refresh, cross-layer runs blind.
    if (hasRunSection) {
      const sig = conductorSignalBridge.getSignals();
      if (sig.density === 1 && sig.tension === 1 && sig.compositeIntensity === 0) {
        throw new Error('crossLayerLifecycleManager: conductorSignalBridge appears stale - conductor signals never refreshed');
      }
    }
    hasRunSection = true;
    crossLayerRegistry.resetSection();
  }

  function resetPhrase() {
    crossLayerRegistry.resetPhrase();
  }

  return { resetAll, resetSection, resetPhrase };
  },
});
