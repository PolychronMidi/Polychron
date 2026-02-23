// src/crossLayer/crossLayerLifecycleManager.js — Delegates to CrossLayerRegistry.
// AbsoluteTimeGrid and TimeStream (from src/time/) register into the lifecycle
// here so they participate in scoped resets automatically.

// Register time-subsystem modules into CrossLayerRegistry for lifecycle management.
// They load before crossLayer (utils → … → time → … → crossLayer) so they exist now.
CrossLayerRegistry.register('AbsoluteTimeGrid', AbsoluteTimeGrid, ['all', 'section']);
CrossLayerRegistry.register('TimeStream', { reset: TimeStream.resetPositions }, ['all']);

CrossLayerLifecycleManager = (() => {
  let hasRunSection = false;

  function resetAll() {
    CrossLayerRegistry.resetAll();
  }

  function resetSection() {
    // After the first section completes, verify the conductor→cross-layer bridge
    // is alive. If conductorSignalBridge failed to refresh, cross-layer runs blind.
    if (hasRunSection) {
      const sig = conductorSignalBridge.getSignals();
      if (sig.density === 1 && sig.tension === 1 && sig.compositeIntensity === 0) {
        throw new Error('CrossLayerLifecycleManager: conductorSignalBridge appears stale — conductor signals never refreshed');
      }
    }
    hasRunSection = true;
    CrossLayerRegistry.resetSection();
  }

  function resetPhrase() {
    CrossLayerRegistry.resetPhrase();
  }

  return { resetAll, resetSection, resetPhrase };
})();
