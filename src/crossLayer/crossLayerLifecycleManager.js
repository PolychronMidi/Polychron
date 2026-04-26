// src/crossLayer/crossLayerLifecycleManager.js - Delegates to crossLayerRegistry.
// L0 and timeStream (from src/time/) register into the lifecycle
// here so they participate in scoped resets automatically.

// Register time-subsystem modules into crossLayerRegistry for lifecycle management.
// Wrapped in registerInitializer so it runs at initializeAll() time, after both
// crossLayerRegistry and timeStream are guaranteed bound -- avoids the legacy
// file-load-time consumer pattern.
moduleLifecycle.registerInitializer('timeStream-crossLayer-registration', () => {
  crossLayerRegistry.register('timeStream', { reset: timeStream.resetPositions }, ['all']);
}, ['crossLayerRegistry', 'timeStream']);

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
