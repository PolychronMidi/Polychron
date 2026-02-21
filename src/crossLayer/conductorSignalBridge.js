// conductorSignalBridge.js — Cross-layer module exposing conductor pipeline signals
// to all cross-layer modules via a curated, stable API.
// Reads signalReader each beat and caches a snapshot so cross-layer modules
// never need to understand ConductorIntelligence internals.

conductorSignalBridge = (() => {
  let cached = {
    density: 1,
    tension: 1,
    flicker: 1,
    compositeIntensity: 0,
    sectionPhase: 'development',
    coherenceEntropy: 0,
    updatedAt: 0
  };

  /**
   * Refresh cached signals from the conductor pipeline.
   * Called each beat from the cross-layer lifecycle.
   */
  function refresh() {
    const snap = signalReader.snapshot();
    cached = {
      density: snap.densityProduct,
      tension: snap.tensionProduct,
      flicker: snap.flickerProduct,
      compositeIntensity: snap.stateFields.compositeIntensity ?? 0,
      sectionPhase: snap.stateFields.sectionPhase ?? 'development',
      coherenceEntropy: snap.stateFields.coherenceEntropy ?? 0,
      updatedAt: Date.now()
    };

    // Emit to ExplainabilityBus when signals reach extremes
    const extremeDensity = cached.density < 0.5 || cached.density > 1.8;
    const extremeTension = cached.tension < 0.5 || cached.tension > 1.8;
    if (extremeDensity || extremeTension) {
      ExplainabilityBus.emit('conductor-signal-extreme', 'bridge', {
        density: cached.density,
        tension: cached.tension,
        flicker: cached.flicker,
        compositeIntensity: cached.compositeIntensity
      });
    }
  }

  /**
   * Stable read API for cross-layer modules.
   * @returns {Readonly<{ density: number, tension: number, flicker: number, compositeIntensity: number, sectionPhase: string, coherenceEntropy: number }>}
   */
  function getSignals() {
    return Object.freeze({
      density: cached.density,
      tension: cached.tension,
      flicker: cached.flicker,
      compositeIntensity: cached.compositeIntensity,
      sectionPhase: cached.sectionPhase,
      coherenceEntropy: cached.coherenceEntropy
    });
  }

  /** Reset to neutral. */
  function reset() {
    cached = {
      density: 1,
      tension: 1,
      flicker: 1,
      compositeIntensity: 0,
      sectionPhase: 'development',
      coherenceEntropy: 0,
      updatedAt: 0
    };
  }

  return { refresh, getSignals, reset };
})();
// Registered as a recorder so refresh() runs each beat automatically.
ConductorIntelligence.registerRecorder('conductorSignalBridge', () => { conductorSignalBridge.refresh(); });
CrossLayerRegistry.register('conductorSignalBridge', conductorSignalBridge, ['all', 'section']);
