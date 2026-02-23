// src/crossLayer/crossLayerLifecycleManager.js — Delegates to CrossLayerRegistry.
// AbsoluteTimeGrid is NOT a crossLayer module (loaded via src/time/), so it is
// still reset directly here. PitchMemoryRecall intentionally never reset.

CrossLayerLifecycleManager = (() => {
  let hasRunSection = false;

  function resetAll() {
    CrossLayerRegistry.resetAll();
    // AbsoluteTimeGrid and TimeStream live in src/time/ — not in the registry
    AbsoluteTimeGrid.reset();
    TimeStream.resetPositions();
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
    AbsoluteTimeGrid.reset();
  }

  function resetPhrase() {
    CrossLayerRegistry.resetPhrase();
  }

  return { resetAll, resetSection, resetPhrase };
})();
