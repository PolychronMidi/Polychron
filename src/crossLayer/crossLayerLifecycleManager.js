// src/crossLayer/crossLayerLifecycleManager.js — Delegates to CrossLayerRegistry.
// AbsoluteTimeGrid is NOT a crossLayer module (loaded via src/time/), so it is
// still reset directly here. PitchMemoryRecall intentionally never reset.

CrossLayerLifecycleManager = (() => {
  function resetAll() {
    CrossLayerRegistry.resetAll();
    // AbsoluteTimeGrid lives in src/time/ — not in the registry
    AbsoluteTimeGrid.reset();
  }

  function resetSection() {
    CrossLayerRegistry.resetSection();
    AbsoluteTimeGrid.reset();
  }

  function resetPhrase() {
    CrossLayerRegistry.resetPhrase();
  }

  return { resetAll, resetSection, resetPhrase };
})();
