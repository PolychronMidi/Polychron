// src/crossLayer/crossLayerLifecycleManager.js - Delegates to crossLayerRegistry.
// absoluteTimeGrid and timeStream (from src/time/) register into the lifecycle
// here so they participate in scoped resets automatically.

// Register time-subsystem modules into crossLayerRegistry for lifecycle management.
// They load before crossLayer (utils - ... - time - ... - crossLayer) so they exist now.
crossLayerRegistry.register('absoluteTimeGrid', absoluteTimeGrid, ['all', 'section']);
crossLayerRegistry.register('timeStream', { reset: timeStream.resetPositions }, ['all']);

crossLayerLifecycleManager = (() => {
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
})();
